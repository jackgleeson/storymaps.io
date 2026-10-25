import { describe, test, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import * as Y from 'yjs';
import registerMaps from '../../server/routes/maps.js';
import {
  serializeDoc, contentEtag, appendLogEntry, diffPush, writeDocFromJson, countCards, loadAndSerialize,
} from '../../server/serialization.js';
import { importFromYaml } from '../../src/transfer/yaml.js';
import { importFromCsv } from '../../src/transfer/csv.js';
import { fullMap, smallMap, cardLayout } from '../fixtures.js';

const LOCK_FILE = 'locks.json';
const STATS_FILE = 'stats.json';

// The route context from server.js, with LevelDB, SQLite and the JSON files replaced by memory
const makeServer = () => {
  const handlers = {};
  const stored = new Map(); // map ID -> Yjs update, standing in for LevelDB
  const files = new Map();  // path -> JSON, standing in for locks.json, stats.json and backups
  const rows = new Map();   // map ID -> SQLite row
  const docs = new Map();   // maps open in a browser
  let nextId = 0;

  const persistence = {
    bindState: async (id, doc) => { if (stored.has(id)) Y.applyUpdate(doc, stored.get(id)); },
    provider: {
      storeUpdate: async (id, update) => {
        stored.set(id, stored.has(id) ? Y.mergeUpdates([stored.get(id), update]) : update);
      },
    },
  };
  const readJson = async (path, fallback) => (files.has(path) ? structuredClone(files.get(path)) : fallback);
  const writeJson = async (path, data) => { files.set(path, structuredClone(data)); };
  const getBackupFile = (id) => `backups/${id}.json`;
  const getPersistence = () => persistence;

  const ctx = {
    route: (method, path, handler) => { handlers[`${method} ${path}`] = handler; },
    Y, docs, getPersistence,
    stmtInsert: { run: (id, name, created, updated) => rows.set(id, { id, name, created_at: created, updated_at: updated, edit_count: 0 }) },
    stmtUpdate: { run: (name, updated, edits, id) => Object.assign(rows.get(id), { name, updated_at: updated, edit_count: rows.get(id).edit_count + edits }) },
    stmtExists: { get: (id) => rows.has(id) },
    stmtMeta: { get: (id) => rows.get(id) },
    editCountSince: null,
    getPendingEdits: () => 0,
    readJson, writeJson, LOCK_FILE, STATS_FILE, getBackupFile,
    serializeDoc, contentEtag, appendLogEntry, diffPush, writeDocFromJson, countCards,
    isRateLimited: (req) => req.limited === true,
    generateUniqueMapId: () => `map${String(++nextId).padStart(5, '0')}`,
    loadAndSerialize: (mapId, host) => loadAndSerialize(mapId, host, { Y, docs, getPersistence, readJson, LOCK_FILE, getBackupFile }),
  };
  registerMaps(ctx);

  // Call a route the way server.js does and collect the response
  const call = async (method, path, { body = {}, headers = {}, limited = false } = {}) => {
    const url = new URL(path, 'http://localhost');
    const [pattern, params] = Object.keys(handlers)
      .map(key => {
        const [m, p] = key.split(' ');
        if (m !== method) return null;
        const re = new RegExp('^' + p.replace(/:([a-zA-Z]+)/g, '(?<$1>[a-zA-Z0-9_-]+)') + '$');
        const match = url.pathname.match(re);
        return match ? [key, { ...match.groups }] : null;
      })
      .find(Boolean) || [];
    assert.ok(pattern, `no route for ${method} ${path}`);
    const res = { status: null, headers: {}, body: '' };
    await handlers[pattern](
      { method, url: path, headers: { host: 'localhost:3000', ...headers }, limited },
      { writeHead: (status, h) => { res.status = status; res.headers = h || {}; }, end: (b) => { res.body = b ?? ''; } },
      params,
      body,
    );
    if ((res.headers['Content-Type'] || '').startsWith('application/json')) res.json = JSON.parse(res.body);
    return res;
  };

  return { call, stored, files, rows, docs };
};

const create = async (server, map = smallMap()) => (await server.call('POST', '/api/maps', { body: map })).json.id;

describe('POST /api/maps', () => {
  let server;
  beforeEach(() => { server = makeServer(); });

  test('creates a map and returns its ID and URL', async () => {
    const res = await server.call('POST', '/api/maps', { body: smallMap(), headers: { 'x-forwarded-proto': 'https' } });
    assert.equal(res.status, 201);
    assert.equal(res.json.id, 'map00001');
    assert.equal(res.json.url, 'https://localhost/map00001');
  });

  test('stores the content, a log entry, the map index row and the map count', async () => {
    const id = await create(server, fullMap());
    const got = await server.call('GET', `/api/maps/${id}`);
    const { app, v, exported, id: _id, site, locked, ...content } = got.json;
    assert.deepEqual(content, fullMap());
    const log = (await server.call('GET', `/api/maps/${id}/log`)).json;
    assert.deepEqual(log.map(e => e.text), ['Created map via CLI']);
    assert.equal(server.rows.get(id).name, 'Coffee app');
    assert.deepEqual(server.files.get(STATS_FILE), { mapCount: 1 });
  });

  test('is rate limited', async () => {
    assert.equal((await server.call('POST', '/api/maps', { body: smallMap(), limited: true })).status, 429);
  });
});

describe('GET /api/maps/:id', () => {
  let server, id;
  beforeEach(async () => { server = makeServer(); id = await create(server, fullMap()); });

  test('returns 404 for a map that does not exist', async () => {
    assert.equal((await server.call('GET', '/api/maps/nothere1')).status, 404);
  });

  test('returns JSON with the ID, site, lock state and an ETag', async () => {
    const res = await server.call('GET', `/api/maps/${id}`);
    assert.equal(res.status, 200);
    assert.equal(res.json.id, id);
    assert.equal(res.json.site, 'localhost');
    assert.equal(res.json.locked, false);
    assert.equal(res.headers.ETag, contentEtag(res.json));
  });

  test('leaves backups out of the response and the ETag', async () => {
    const before = (await server.call('GET', `/api/maps/${id}`)).headers.ETag;
    server.files.set(`backups/${id}.json`, [{ id: 'b1', timestamp: 1, note: 'x' }]);
    const res = await server.call('GET', `/api/maps/${id}`);
    assert.equal('backups' in res.json, false);
    assert.equal(res.headers.ETag, before, 'the ETag ignores backups');
  });

  test('returns YAML that reads back as the same map', async () => {
    const res = await server.call('GET', `/api/maps/${id}?format=yaml`);
    assert.match(res.headers['Content-Type'], /^text\/yaml/);
    assert.deepEqual(cardLayout(importFromYaml(res.body)), cardLayout(fullMap()));
  });

  test('returns CSV as a download named after the map', async () => {
    const res = await server.call('GET', `/api/maps/${id}?format=csv`);
    assert.match(res.headers['Content-Type'], /^text\/csv/);
    assert.equal(res.headers['Content-Disposition'], 'attachment; filename="coffee-app.csv"');
    assert.equal(importFromCsv(res.body).name, 'Coffee app');
  });
});

describe('PUT /api/maps/:id', () => {
  let server, id;
  beforeEach(async () => { server = makeServer(); id = await create(server); });

  const pull = async () => (await server.call('GET', `/api/maps/${id}`));
  const edited = (name = 'Renamed') => ({ ...smallMap(), name });

  test('replaces the map and logs what changed', async () => {
    const res = await server.call('PUT', `/api/maps/${id}`, { body: edited() });
    assert.equal(res.status, 200);
    assert.equal((await pull()).json.name, 'Renamed');
    const log = (await server.call('GET', `/api/maps/${id}/log`)).json;
    assert.equal(log[0].text, 'Renamed map');
    assert.equal(server.rows.get(id).edit_count, 1);
  });

  test('a push that changes nothing is not counted as an edit', async () => {
    await server.call('PUT', `/api/maps/${id}`, { body: smallMap() });
    assert.equal(server.rows.get(id).edit_count, 0);
  });

  test('updates a map that is open in a browser in place', async () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, server.stored.get(id));
    server.docs.set(id, doc);
    await server.call('PUT', `/api/maps/${id}`, { body: edited('Live') });
    assert.equal(doc.getMap('storymap').get('name'), 'Live');
  });

  test('needs steps or slices', async () => {
    const res = await server.call('PUT', `/api/maps/${id}`, { body: { name: 'Empty' } });
    assert.equal(res.status, 400);
  });

  test('refuses a locked map without the right password', async () => {
    server.files.set(LOCK_FILE, { [id]: { isLocked: true, passwordHash: 'hash123' } });
    assert.equal((await server.call('PUT', `/api/maps/${id}`, { body: edited() })).status, 423);
    assert.equal((await server.call('PUT', `/api/maps/${id}`, { body: edited(), headers: { 'x-lock-password': 'wrong' } })).status, 423);
    assert.equal((await pull()).json.name, 'Small', 'the map is unchanged');
  });

  test('accepts a locked map with the right password', async () => {
    server.files.set(LOCK_FILE, { [id]: { isLocked: true, passwordHash: 'hash123' } });
    const res = await server.call('PUT', `/api/maps/${id}`, { body: edited(), headers: { 'x-lock-password': 'hash123' } });
    assert.equal(res.status, 200);
  });

  test('refuses a push based on an old version (If-Match)', async () => {
    const etag = (await pull()).headers.ETag;
    await server.call('PUT', `/api/maps/${id}`, { body: edited('Someone else') });
    const res = await server.call('PUT', `/api/maps/${id}`, { body: edited('Mine'), headers: { 'if-match': etag } });
    assert.equal(res.status, 409);
    assert.equal((await pull()).json.name, 'Someone else');
  });

  test('accepts a push based on the current version', async () => {
    const etag = (await pull()).headers.ETag;
    const res = await server.call('PUT', `/api/maps/${id}`, { body: edited('Mine'), headers: { 'if-match': etag } });
    assert.equal(res.status, 200);
  });

  test('without If-Match a push always overwrites', async () => {
    await server.call('PUT', `/api/maps/${id}`, { body: edited('Someone else') });
    assert.equal((await server.call('PUT', `/api/maps/${id}`, { body: edited('Mine') })).status, 200);
    assert.equal((await pull()).json.name, 'Mine');
  });

  test('is rate limited', async () => {
    assert.equal((await server.call('PUT', `/api/maps/${id}`, { body: edited(), limited: true })).status, 429);
  });
});

describe('GET /api/maps/:id/log and /meta', () => {
  test('the log lists the newest entry first', async () => {
    const server = makeServer();
    const id = await create(server);
    await server.call('PUT', `/api/maps/${id}`, { body: { ...smallMap(), name: 'Second' } });
    const log = (await server.call('GET', `/api/maps/${id}/log`)).json;
    assert.deepEqual(log.map(e => e.text), ['Renamed map', 'Created map via CLI']);
  });

  test('the log and meta return 404 for a map that does not exist', async () => {
    const server = makeServer();
    assert.equal((await server.call('GET', '/api/maps/nothere1/log')).status, 404);
    assert.equal((await server.call('GET', '/api/maps/nothere1/meta')).status, 404);
  });

  test('meta returns the dates and the edit count', async () => {
    const server = makeServer();
    const id = await create(server);
    await server.call('PUT', `/api/maps/${id}`, { body: { ...smallMap(), name: 'Second' } });
    const meta = (await server.call('GET', `/api/maps/${id}/meta`)).json;
    assert.equal(meta.edit_count, 1);
    assert.ok(meta.created_at && meta.updated_at);
  });
});

describe('GET /api/maps/new-id', () => {
  test('returns a new ID', async () => {
    const res = await makeServer().call('GET', '/api/maps/new-id');
    assert.equal(res.status, 200);
    assert.equal(res.json.id, 'map00001');
  });

  test('is rate limited', async () => {
    assert.equal((await makeServer().call('GET', '/api/maps/new-id', { limited: true })).status, 429);
  });
});
