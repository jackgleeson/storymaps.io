import { describe, test, before, after, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { WebsocketProvider } from 'y-websocket';
import { writeDocFromJson } from '../../server/serialization.js';
import { smallMap } from '../fixtures.js';
import { startServer } from './server-process.js';

const ORIGIN = 'http://localhost:3000';
let server, base, wsBase, dataDir;

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'storymaps-test-'));
  server = await startServer(dataDir);
  ({ base, wsBase } = server);
});

after(async () => {
  await server.stop();
  await rm(dataDir, { recursive: true, force: true });
});

const api = async (method, path, { body, yaml = false, headers = {} } = {}) => {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.headers['Content-Type'] = yaml ? 'text/yaml' : 'application/json';
    init.body = yaml || typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await fetch(base + path, init);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, headers: res.headers, text, json };
};

// A raw request, for paths fetch() would tidy up (like /../server.js)
const rawGet = (path) => new Promise((resolve, reject) => {
  const req = request(base + '/', { path }, (res) => {
    let text = '';
    res.on('data', (chunk) => { text += chunk; });
    res.on('end', () => resolve({ status: res.statusCode, text }));
  });
  req.on('error', reject);
  req.end();
});

let nextAddress = 0;
const newAddress = () => ({ 'x-forwarded-for': `198.51.100.${++nextAddress}` });
const createMap = async (map = smallMap()) => (await api('POST', '/api/maps', { body: map, headers: newAddress() })).json.id;

const waitFor = async (check, label, ms = 5_000) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(`timed out waiting for ${label}`);
};

// A browser-like client: a Yjs document connected to the server over a WebSocket
class BrowserWebSocket extends WebSocket {
  constructor(url, protocols) { super(url, protocols, { origin: ORIGIN }); }
}
const providers = [];
const connect = async (mapId) => {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(wsBase, mapId, doc, { WebSocketPolyfill: BrowserWebSocket, disableBc: true });
  providers.push(provider);
  await waitFor(() => provider.synced, 'the first sync');
  return { doc, provider, ymap: doc.getMap('storymap') };
};
afterEach(() => {
  while (providers.length) {
    const provider = providers.pop();
    provider.destroy();
    provider.doc.destroy(); // also stops the presence timer, which would keep the test running
  }
});

describe('WebSocket sync', () => {
  test('refuses a connection from another site', async () => {
    const ws = new WebSocket(`${wsBase}/abc12345`, { origin: 'https://evil.example' });
    const [code] = await once(ws, 'close');
    assert.equal(code, 4403);
  });

  test('refuses a connection to anything but a map', async () => {
    for (const room of ['api/maps', 'weird%20name', 'abc1234', 'abc123456', 'ABCD1234']) {
      const ws = new WebSocket(`${wsBase}/${room}`, { origin: ORIGIN });
      const [code] = await once(ws, 'close');
      assert.equal(code, 4400, room);
    }
  });

  test('refuses a connection with no origin', async () => {
    const ws = new WebSocket(`${wsBase}/abc12345`);
    const [code] = await once(ws, 'close');
    assert.equal(code, 4403);
  });

  // A flood of one-byte message fragments once made the server hold far more memory than the
  // message size limit allows, until it ran out (GHSA-96hv-2xvq-fx4p, fixed in ws 8.21.0)
  test('closes a connection that floods tiny message fragments, and keeps serving', async () => {
    const ws = new WebSocket(`${wsBase}/flood123`, { origin: ORIGIN });
    await once(ws, 'open');
    const closed = once(ws, 'close');
    const MAX = 200_000;
    let sent = 0;
    const fragment = Buffer.alloc(1);
    const send = () => {
      if (ws.readyState !== WebSocket.OPEN || sent >= MAX) return;
      sent++;
      ws.send(fragment, { fin: false }, (err) => { if (!err) send(); });
    };
    send();
    const timeout = new Promise((resolve) => setTimeout(() => resolve(['timed out']), 15_000));
    const [code] = await Promise.race([closed, timeout]);
    ws.terminate();
    // The server's close frame can be lost while the client is still sending, so any close
    // counts. Sends finish before the server reads them, so the count sent proves nothing.
    assert.notEqual(code, 'timed out', `the server should cut the connection off after ${sent} fragments`);
    assert.equal((await api('GET', '/api/stats')).status, 200);
  });

  test('a client gets a map made over the API', async () => {
    const id = await createMap();
    const { ymap } = await connect(id);
    assert.equal(ymap.get('name'), 'Small');
    assert.equal(ymap.get('columns').length, 2);
  });

  test('an edit from one client reaches the other', async () => {
    const id = await createMap();
    const a = await connect(id);
    const b = await connect(id);
    a.ymap.set('name', 'Edited live');
    await waitFor(() => b.ymap.get('name') === 'Edited live', 'the edit to arrive');
  });

  test('an edit over the WebSocket can be pulled from the API', async () => {
    const id = await createMap();
    const a = await connect(id);
    a.ymap.set('name', 'Saved by the browser');
    await waitFor(async () => (await api('GET', `/api/maps/${id}`)).json?.name === 'Saved by the browser', 'the API to return the edit');
  });

  test('a map is still there after everyone leaves', async () => {
    const id = await createMap();
    const a = await connect(id);
    a.ymap.set('name', 'Kept on disk');
    await new Promise(resolve => setTimeout(resolve, 200));
    a.provider.destroy();
    const b = await connect(id);
    assert.equal(b.ymap.get('name'), 'Kept on disk');
  });

  test('a push over the API reaches a connected client', async () => {
    const id = await createMap();
    const a = await connect(id);
    await api('PUT', `/api/maps/${id}`, { body: { ...smallMap(), name: 'Pushed by the CLI' } });
    await waitFor(() => a.ymap.get('name') === 'Pushed by the CLI', 'the push to arrive');
  });

  test('a new map made in the browser is added to the map index', async () => {
    const doc = new Y.Doc();
    writeDocFromJson(doc, smallMap(), Y);
    const id = 'brows3r1';
    const a = await connect(id);
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(doc));
    await waitFor(async () => (await api('GET', `/api/maps/${id}/meta`)).status === 200, 'the map index row');
  });

  test('activity log entries from the browser count as edits', async () => {
    const id = await createMap();
    const a = await connect(id);
    a.doc.getArray('log').push([{ ts: Date.now(), src: 'web', text: 'Added a card', sid: 's1', ids: [] }]);
    // Edit counts are written 2 seconds after the last change
    await waitFor(async () => (await api('GET', `/api/maps/${id}/meta`)).json?.edit_count === 1, 'the edit count', 6_000);
  });
});

// A SHA-256 of the password, as the app and the CLI send it
const h = (password) => createHash('sha256').update(password).digest('hex');
// Locking and unlocking allow 5 a minute from one address, so each request has its own
const lockPost = (path, body, headers = {}) => api('POST', path, { body, headers: { ...newAddress(), ...headers } });

describe('locks', () => {
  test('a map can be locked, and unlocked with the password', async () => {
    const id = await createMap();
    await lockPost(`/api/lock/${id}`, { passwordHash: h('owner-hash') });
    assert.equal((await api('GET', `/api/lock/${id}`)).json.isLocked, true);
    assert.equal((await lockPost(`/api/lock/${id}/unlock`, { passwordHash: h('wrong') })).status, 403);
    assert.equal((await lockPost(`/api/lock/${id}/unlock`, { passwordHash: h('owner-hash') })).status, 200);
  });

  test('the owner can lock again with the same password', async () => {
    const id = await createMap();
    await lockPost(`/api/lock/${id}`, { passwordHash: h('owner-hash') });
    assert.equal((await lockPost(`/api/lock/${id}`, { passwordHash: h('owner-hash') })).status, 200);
  });

  test('the password can be changed by sending the current one', async () => {
    const id = await createMap();
    await lockPost(`/api/lock/${id}`, { passwordHash: h('old-hash') });
    const change = await lockPost(`/api/lock/${id}`, { passwordHash: h('new-hash'), currentPasswordHash: h('old-hash') });
    assert.equal(change.status, 200);
    assert.equal((await lockPost(`/api/lock/${id}/unlock`, { passwordHash: h('old-hash') })).status, 403);
    assert.equal((await lockPost(`/api/lock/${id}/unlock`, { passwordHash: h('new-hash') })).status, 200);
  });

  test('a wrong current password does not change the password', async () => {
    const id = await createMap();
    await lockPost(`/api/lock/${id}`, { passwordHash: h('owner-hash') });
    const change = await lockPost(`/api/lock/${id}`, { passwordHash: h('new-hash'), currentPasswordHash: h('guess') });
    assert.equal(change.status, 403);
  });

  test('locking a map that is already locked needs its password', async () => {
    const id = await createMap();
    await lockPost(`/api/lock/${id}`, { passwordHash: h('owner-hash') });
    const takeover = await lockPost(`/api/lock/${id}`, { passwordHash: h('someone-else') });
    assert.equal(takeover.status, 403);
    assert.equal((await lockPost(`/api/lock/${id}/unlock`, { passwordHash: h('owner-hash') })).status, 200, 'the owner can still unlock');
  });

  test('a lock needs a SHA-256 password hash, and a map that exists', async () => {
    const id = await createMap();
    for (const passwordHash of ['short', 'x'.repeat(64), { a: 1 }, h('a').repeat(1000)]) {
      assert.equal((await lockPost(`/api/lock/${id}`, { passwordHash })).status, 400, JSON.stringify(passwordHash).slice(0, 20));
    }
    assert.equal((await lockPost('/api/lock/nosuchmap1', { passwordHash: h('a') })).status, 404);
    assert.equal((await api('GET', `/api/lock/${id}`)).json.isLocked, false);
  });

  test('guessing the password by locking again is rate limited', async () => {
    const id = await createMap();
    await lockPost(`/api/lock/${id}`, { passwordHash: h('owner') });
    const from = { 'x-forwarded-for': '203.0.113.90' };
    const tries = [];
    for (let i = 0; i < 6; i++) tries.push((await lockPost(`/api/lock/${id}`, { passwordHash: h(`guess${i}`) }, from)).status);
    assert.deepEqual(tries, [403, 403, 403, 403, 403, 429]);
  });

  test('a locked map takes no live edits from a connection without the password', async () => {
    const id = await createMap();
    await lockPost(`/api/lock/${id}`, { passwordHash: h('owner') });
    const { ymap } = await connect(id);
    ymap.set('name', 'Changed while locked');
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.notEqual((await api('GET', `/api/maps/${id}`)).json.name, 'Changed while locked');
  });

  test('a connection that sends the password can edit a locked map', async () => {
    const id = await createMap();
    await lockPost(`/api/lock/${id}`, { passwordHash: h('owner') });
    const { ymap, provider } = await connect(id);
    provider.ws.send(`lock:${h('wrong')}`);
    ymap.set('name', 'Wrong password');
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.notEqual((await api('GET', `/api/maps/${id}`)).json.name, 'Wrong password');
    provider.ws.send(`lock:${h('owner')}`);
    ymap.set('name', 'Unlocked edit');
    await waitFor(async () => (await api('GET', `/api/maps/${id}`)).json.name === 'Unlocked edit', 'the edit');
  });
});

describe('HTTP API', () => {
  test('an unknown API path is a 404', async () => {
    assert.equal((await api('GET', '/api/nothing')).status, 404);
  });

  test('the map count is the maps that exist, even when many are made at the same moment', async () => {
    const before = (await api('GET', '/api/stats')).json.mapCount;
    const made = await Promise.all(Array.from({ length: 30 }, () => api('POST', '/api/maps', { body: smallMap(), headers: newAddress() })));
    assert.ok(made.every(r => r.status === 201));
    assert.equal((await api('GET', '/api/stats')).json.mapCount, before + 30);
  });

  test('backups of the same map made at the same moment keep one copy, in a file that still reads', async () => {
    const id = await createMap();
    const made = await Promise.all(Array.from({ length: 6 }, (_, i) => api('POST', `/api/backups/${id}`, { body: { note: `b${i}` }, headers: { origin: ORIGIN, ...newAddress() } })));
    assert.ok(made.every(r => r.status === 200));
    assert.equal(new Set(made.map(r => r.json.id)).size, 1, 'every request answers with the same backup');
    assert.equal(made.filter(r => r.json.unchanged).length, 5);
    assert.equal((await api('GET', `/api/backups/${id}`)).json.length, 1);
  });

  test('an imported backup keeps only the fields the app reads, and cannot claim to be from the future', async () => {
    const id = await createMap();
    const backups = [
      { id: 'future', data: '{}', timestamp: '9999-01-01T00:00:00Z', cardCount: '<img src=x onerror=alert(1)>', extra: 'x' },
      { id: 'notjson', data: '<script>' },
      { id: '../escape', data: '{}' },
    ];
    assert.equal((await api('POST', `/api/backups/${id}/import`, { body: { backups }, headers: { origin: ORIGIN, ...newAddress() } })).status, 200);
    const list = (await api('GET', `/api/backups/${id}`)).json;
    assert.deepEqual(list.map(b => b.id), ['future']);
    assert.equal(list[0].cardCount, 0);
    assert.ok(Date.parse(list[0].timestamp) <= Date.now());
    assert.equal((await api('GET', `/api/backups/${id}/future`)).json.extra, undefined);
    assert.equal((await api('POST', '/api/backups/nosuchmap1/import', { body: { backups }, headers: { origin: ORIGIN, ...newAddress() } })).status, 404);
  });

  test('backups of a locked map are only made or imported with its password, and never deleted', async () => {
    const id = await createMap();
    const made = (await api('POST', `/api/backups/${id}`, { body: { note: 'x' }, headers: { origin: ORIGIN, ...newAddress() } })).json;
    await lockPost(`/api/lock/${id}`, { passwordHash: h('owner') });
    const backups = [{ id: 'imported1', data: '{}' }];
    const headers = { origin: ORIGIN };
    assert.equal((await api('POST', `/api/backups/${id}`, { body: { note: 'y' }, headers: { ...newAddress() } })).status, 423, 'not from the CLI');
    assert.equal((await api('POST', `/api/backups/${id}`, { body: { note: 'y' }, headers: { ...headers, ...newAddress() } })).status, 423, 'not from the app');
    assert.equal((await api('POST', `/api/backups/${id}/import`, { body: { backups }, headers: { ...headers, ...newAddress() } })).status, 423);
    assert.equal((await api('GET', `/api/backups/${id}`)).json.length, 1);
    const withPassword = { ...headers, 'x-lock-password': h('owner') };
    assert.equal((await api('POST', `/api/backups/${id}/import`, { body: { backups }, headers: { ...withPassword, ...newAddress() } })).status, 200);
    assert.notEqual((await api('DELETE', `/api/backups/${id}/${made.id}`, { headers: withPassword })).status, 200);
    assert.deepEqual((await api('GET', `/api/backups/${id}`)).json.map(b => b.id).sort(), [made.id, 'imported1'].sort());
  });

  test('writes from another site are refused, except the CLI routes', async () => {
    const id = await createMap();
    const fromEvil = await api('POST', `/api/backups/${id}/import`, { body: { backups: [] }, headers: { origin: 'https://evil.example' } });
    assert.equal(fromEvil.status, 403);
    const noOrigin = await api('POST', `/api/backups/${id}/import`, { body: { backups: [] } });
    assert.equal(noOrigin.status, 403);
    assert.equal((await api('POST', '/api/maps', { body: smallMap() })).status, 201, 'the CLI can create maps without an origin');
    const cliRouteFromEvil = await api('POST', '/api/maps', { body: smallMap(), headers: { origin: 'https://evil.example', ...newAddress() } });
    assert.equal(cliRouteFromEvil.status, 403, 'another site cannot use the CLI routes either');
    const backup = await api('POST', `/api/backups/${id}`, { body: { note: 'x' }, headers: { 'x-forwarded-for': '203.0.113.78' } });
    assert.equal(backup.status, 200, 'the CLI can make a backup without an origin');
    const [entry] = (await api('GET', `/api/maps/${id}/log`)).json;
    assert.deepEqual([entry.src, entry.text], ['cli', 'Created backup'], 'and it goes in the activity log');
  });

  test('one address can create 10 maps a minute, while others still can', async () => {
    const headers = { 'x-forwarded-for': '203.0.113.50' };
    for (let i = 0; i < 10; i++) {
      assert.equal((await api('POST', '/api/maps', { body: smallMap(), headers })).status, 201, `map ${i + 1}`);
    }
    const refused = await api('POST', '/api/maps', { body: smallMap(), headers });
    assert.equal(refused.status, 429);
    assert.equal(refused.json.error, 'Too many new maps from your address. Try again later.');
    assert.equal((await api('POST', '/api/maps', { body: smallMap(), headers: newAddress() })).status, 201);
  });

  test('invalid JSON is a 400', async () => {
    const res = await api('POST', '/api/maps', { body: '{nope' });
    assert.equal(res.status, 400);
    assert.equal(res.json.error, 'Invalid JSON');
  });

  test('YAML that fails validation is a 400 with the errors', async () => {
    const res = await api('POST', '/api/maps', { body: 'name: x\nsteps: []\n', yaml: true });
    assert.equal(res.status, 400);
    assert.deepEqual(res.json.errors, ['Missing or empty "steps" list']);
  });

  test('a map can be created from YAML', async () => {
    const res = await api('POST', '/api/maps', { body: 'name: From YAML\nsteps:\n  - Browse\n', yaml: true });
    assert.equal(res.status, 201);
    assert.equal((await api('GET', `/api/maps/${res.json.id}`)).json.name, 'From YAML');
  });

  test('a body over 5 MB is refused', async () => {
    const res = await fetch(`${base}/api/maps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(5_242_881) })
      .then(r => r.status, () => 'connection closed');
    assert.ok(res === 413 || res === 'connection closed', `got ${res}`);
  });
});

describe('pages and files', () => {
  test('serves the app at / and at a map URL', async () => {
    for (const path of ['/', '/abc12345']) {
      const res = await api('GET', path);
      assert.equal(res.status, 200, path);
      assert.match(res.headers.get('content-type'), /text\/html/);
      assert.match(res.text, /<title>/);
    }
  });

  test('serves source files and compresses them', async () => {
    const res = await api('GET', '/src/core/constants.js');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/javascript/);
    assert.equal(res.headers.get('content-encoding'), 'gzip');
    assert.match(res.text, /generateId/);
  });

  test('answers 304 when the file has not changed', async () => {
    const first = await api('GET', '/src/core/constants.js');
    const again = await api('GET', '/src/core/constants.js', { headers: { 'if-none-match': first.headers.get('etag') } });
    assert.equal(again.status, 304);
  });

  test('files outside public and src cannot be read', async () => {
    for (const path of ['/../server.js', '/src/../server.js', '/src/../../package.json', '/%2e%2e/server.js', '/data/locks.json',
      '/server/admin/delete-map.js', '/src/../server/admin/delete-map.js', '/%2e%2e/server/admin/delete-map.js']) {
      const res = await rawGet(path);
      assert.ok(!res.text.includes('createServer') && !res.text.includes('"dependencies"') && !res.text.includes('passwordHash') && !res.text.includes('clearDocument'), `${path} leaked a file`);
    }
  });

  test('keeps story maps and projects out of search results, and leaves the pages to find alone', async () => {
    for (const path of ['/abc12345', '/new', '/sample/recipe-app', '/p/abc12345', '/p/abc12345/def67890']) {
      assert.equal((await fetch(`${base}${path}`)).headers.get('x-robots-tag'), 'noindex', path);
    }
    for (const path of ['/', '/tour', '/privacy.html']) {
      assert.equal((await fetch(`${base}${path}`)).headers.get('x-robots-tag'), null, path);
    }
  });

  test('AI tools may fetch the format links of a map, which stay out of search results', async () => {
    const robots = await (await fetch(`${base}/robots.txt`)).text();
    assert.ok(!/\.(yaml|json|csv)/.test(robots), 'robots.txt leaves the format links open');
    assert.match(robots, /Disallow: \/api\//);

    const id = await createMap();
    for (const ext of ['yaml', 'json', 'csv']) {
      const res = await fetch(`${base}/${id}.${ext}`);
      assert.equal(res.status, 200, ext);
      assert.equal(res.headers.get('x-robots-tag'), 'noindex', ext);
    }
  });

  test('map, project and sample links get the app, and paths scanners probe are a 404', async () => {
    for (const path of ['/abc12345', '/new', '/tour', '/sample/recipe-app', '/p/abc12345', '/p/abc12345/def67890', '/p/abc12345/']) {
      const res = await rawGet(path);
      assert.equal(res.status, 200, path);
      assert.ok(res.text.includes('<html'), `${path} got the app`);
    }
    for (const path of ['/src/./core/constants.js', '/src//core/constants.js', '/src/core/constants.js/', '/.env', '/%2eenv', '/.git/config', '/.git', '/wp-login.php', '/:3000', '/[id]', '/*',
      '/abc12345/', '/blog/wp-includes/js/json2.js', '/sample/x/y']) {
      assert.equal((await rawGet(path)).status, 404, path);
    }
  });

  test('a map can be downloaded as JSON, YAML or CSV from its URL', async () => {
    const id = await createMap();
    assert.equal(JSON.parse((await api('GET', `/${id}.json`)).text).name, 'Small');
    assert.match((await api('GET', `/${id}.yaml`)).text, /^name: Small/m);
    const csv = await api('GET', `/${id}.csv`);
    assert.match(csv.headers.get('content-disposition'), /filename="small\.csv"/);
  });

  test('a map downloaded from its URL leaves out its backups', async () => {
    const id = await createMap();
    const headers = { origin: ORIGIN, 'x-forwarded-for': '203.0.113.77' };
    assert.equal((await api('POST', `/api/backups/${id}`, { body: { note: 'before import' }, headers })).status, 200);
    assert.equal((await api('GET', `/api/backups/${id}`)).json.length, 1, 'the backup was made');
    assert.equal(JSON.parse((await api('GET', `/${id}.json`)).text).backups, undefined);
    const yaml = (await api('GET', `/${id}.yaml`)).text;
    assert.match(yaml, /^name: Small/m);
    assert.doesNotMatch(yaml, /backups:|before import/);
  });

  test('/favicon.ico redirects to the SVG icon', async () => {
    const res = await fetch(`${base}/favicon.ico`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/favicon.svg');
  });
});
