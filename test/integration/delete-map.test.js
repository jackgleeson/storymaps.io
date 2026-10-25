import { test, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { WebsocketProvider } from 'y-websocket';
import { writeDocFromJson } from '../../server/serialization.js';
import { smallMap } from '../fixtures.js';
import { ROOT, startServer, testEnv } from './server-process.js';

const run = promisify(execFile);
let dataDir;
before(async () => { dataDir = await mkdtemp(join(tmpdir(), 'storymaps-delete-')); });
after(() => rm(dataDir, { recursive: true, force: true }));

const call = async (base, method, path, body) => {
  const res = await fetch(base + path, {
    method,
    // The backups route only accepts writes from the site itself
    headers: { 'Content-Type': 'application/json', origin: 'http://localhost:3000' },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

// Make a map with a chosen ID, the way the browser does: open it over the WebSocket and fill it in
class BrowserWebSocket extends WebSocket {
  constructor(url, protocols) { super(url, protocols, { origin: 'http://localhost:3000' }); }
}
const createMapWithId = async (server, id, name) => {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(server.wsBase, id, doc, { WebSocketPolyfill: BrowserWebSocket, disableBc: true });
  await new Promise(resolve => provider.once('sync', resolve));
  writeDocFromJson(doc, { ...smallMap(), name }, Y);
  for (let i = 0; i < 100 && (await call(server.base, 'GET', `/api/maps/${id}`)).json?.name !== name; i++) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  await call(server.base, 'POST', `/api/backups/${id}`, { note: 'x' });
  await call(server.base, 'POST', `/api/lock/${id}`, { passwordHash: 'h' });
  provider.destroy();
  doc.destroy();
};

// The script must run with the server stopped, as LevelDB allows one process at a time
const deleteMap = (...args) => run(process.execPath, ['server/admin/delete-map.js', ...args], { cwd: ROOT, env: testEnv(dataDir) });

test('deletes exactly one map, leaving maps whose IDs start the same way untouched', async () => {
  let server = await startServer(dataDir);
  await createMapWithId(server, 'abcd1234', 'Delete me');
  await createMapWithId(server, 'abcd12345', 'Longer ID');
  await createMapWithId(server, 'abcd123', 'Shorter ID');
  await server.stop();

  const dryRun = await deleteMap('--dry-run', 'abcd1234');
  assert.equal(dryRun.stdout, 'abcd1234: would delete data, index, backups, lock\n');
  const result = await deleteMap('abcd1234');
  assert.equal(result.stdout, 'abcd1234: deleted data, index, backups, lock\n');

  server = await startServer(dataDir);
  try {
    assert.equal((await call(server.base, 'GET', '/api/maps/abcd1234')).status, 404);
    assert.equal((await call(server.base, 'GET', '/api/maps/abcd1234/meta')).status, 404);
    assert.deepEqual((await call(server.base, 'GET', '/api/backups/abcd1234')).json, []);
    assert.equal((await call(server.base, 'GET', '/api/lock/abcd1234')).json.isLocked, false);
    for (const [id, name] of [['abcd12345', 'Longer ID'], ['abcd123', 'Shorter ID']]) {
      assert.equal((await call(server.base, 'GET', `/api/maps/${id}`)).json.name, name, id);
      assert.equal((await call(server.base, 'GET', `/api/maps/${id}/meta`)).status, 200, id);
      assert.equal((await call(server.base, 'GET', `/api/backups/${id}`)).json.length, 1, id);
      assert.equal((await call(server.base, 'GET', `/api/lock/${id}`)).json.isLocked, true, id);
    }
  } finally {
    await server.stop();
  }
});

test('the dry run changes nothing', async () => {
  let server = await startServer(dataDir);
  const id = (await call(server.base, 'POST', '/api/maps', smallMap())).json.id;
  await server.stop();
  await deleteMap('--dry-run', id);
  server = await startServer(dataDir);
  try {
    assert.equal((await call(server.base, 'GET', `/api/maps/${id}`)).status, 200);
  } finally {
    await server.stop();
  }
});

test('takes exactly one map ID', async () => {
  const refused = (pattern) => (err) => err.code === 1 && pattern.test(err.stderr);
  await assert.rejects(deleteMap('abcd12345', 'abcd123'), refused(/Give exactly one map ID/));
  await assert.rejects(deleteMap(), refused(/Give exactly one map ID/));
  await assert.rejects(deleteMap('--dry-run'), refused(/Give exactly one map ID/));
});

test('refuses anything that is not a map ID, and a map that does not exist', async () => {
  await assert.rejects(deleteMap('../maps'), (err) => err.code === 1 && /Not a map ID: \.\.\/maps/.test(err.stderr));
  await assert.rejects(deleteMap('nothere1'), (err) => err.code === 1 && /nothere1: not found/.test(err.stderr));
});
