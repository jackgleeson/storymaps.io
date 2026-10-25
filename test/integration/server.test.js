import { describe, test, before, after, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
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

  test('refuses a connection with no origin', async () => {
    const ws = new WebSocket(`${wsBase}/abc12345`);
    const [code] = await once(ws, 'close');
    assert.equal(code, 4403);
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

describe('locks', () => {
  test('a map can be locked, and unlocked with the password', async () => {
    const id = await createMap();
    await api('POST', `/api/lock/${id}`, { body: { passwordHash: 'owner-hash' } });
    assert.equal((await api('GET', `/api/lock/${id}`)).json.isLocked, true);
    assert.equal((await api('POST', `/api/lock/${id}/unlock`, { body: { passwordHash: 'wrong' } })).status, 403);
    assert.equal((await api('POST', `/api/lock/${id}/unlock`, { body: { passwordHash: 'owner-hash' } })).status, 200);
  });

  test('the owner can lock again with the same password', async () => {
    const id = await createMap();
    await api('POST', `/api/lock/${id}`, { body: { passwordHash: 'owner-hash' } });
    assert.equal((await api('POST', `/api/lock/${id}`, { body: { passwordHash: 'owner-hash' } })).status, 200);
  });

  test('the password can be changed by sending the current one', async () => {
    const id = await createMap();
    await api('POST', `/api/lock/${id}`, { body: { passwordHash: 'old-hash' } });
    const change = await api('POST', `/api/lock/${id}`, { body: { passwordHash: 'new-hash', currentPasswordHash: 'old-hash' } });
    assert.equal(change.status, 200);
    assert.equal((await api('POST', `/api/lock/${id}/unlock`, { body: { passwordHash: 'old-hash' } })).status, 403);
    assert.equal((await api('POST', `/api/lock/${id}/unlock`, { body: { passwordHash: 'new-hash' } })).status, 200);
  });

  test('a wrong current password does not change the password', async () => {
    const id = await createMap();
    await api('POST', `/api/lock/${id}`, { body: { passwordHash: 'owner-hash' } });
    const change = await api('POST', `/api/lock/${id}`, { body: { passwordHash: 'new-hash', currentPasswordHash: 'guess' } });
    assert.equal(change.status, 403);
  });

  test('locking a map that is already locked needs its password', async () => {
    const id = await createMap();
    await api('POST', `/api/lock/${id}`, { body: { passwordHash: 'owner-hash' } });
    const takeover = await api('POST', `/api/lock/${id}`, { body: { passwordHash: 'someone-else' } });
    assert.equal(takeover.status, 403);
    assert.equal((await api('POST', `/api/lock/${id}/unlock`, { body: { passwordHash: 'owner-hash' } })).status, 200, 'the owner can still unlock');
  });
});

describe('HTTP API', () => {
  test('an unknown API path is a 404', async () => {
    assert.equal((await api('GET', '/api/nothing')).status, 404);
  });

  test('writes from another site are refused, except the CLI routes', async () => {
    const id = await createMap();
    const fromEvil = await api('POST', `/api/backups/${id}`, { body: { note: 'x' }, headers: { origin: 'https://evil.example' } });
    assert.equal(fromEvil.status, 403);
    const noOrigin = await api('POST', `/api/backups/${id}`, { body: { note: 'x' } });
    assert.equal(noOrigin.status, 403);
    assert.equal((await api('POST', '/api/maps', { body: smallMap() })).status, 201, 'the CLI can create maps without an origin');
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

  test('a map can be downloaded as JSON, YAML or CSV from its URL', async () => {
    const id = await createMap();
    assert.equal(JSON.parse((await api('GET', `/${id}.json`)).text).name, 'Small');
    assert.match((await api('GET', `/${id}.yaml`)).text, /^name: Small/m);
    const csv = await api('GET', `/${id}.csv`);
    assert.match(csv.headers.get('content-disposition'), /filename="small\.csv"/);
  });

  test('/favicon.ico redirects to the SVG icon', async () => {
    const res = await fetch(`${base}/favicon.ico`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/favicon.svg');
  });
});
