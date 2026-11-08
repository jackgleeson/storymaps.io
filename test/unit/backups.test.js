import { describe, test, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import registerBackups from '../../server/routes/backups.js';
import registerStats from '../../server/routes/stats.js';
import { countCards } from '../../server/serialization.js';
import { smallMap } from '../fixtures.js';

// The backups and stats routes from server.js, with the JSON files kept in memory
let handlers, files, maps, docs, mapCount, logged;
beforeEach(() => {
  mapCount = 0;
  logged = [];
  handlers = {};
  files = new Map();
  maps = new Map([['abc12345', { app: 'storymap', v: 1, exported: 'x', name: 'Small', id: 'abc12345', site: 'localhost', locked: false, ...smallMap() }]]);
  docs = new Map();
  const ctx = {
    route: (method, path, handler) => { handlers[`${method} ${path}`] = handler; },
    isProxyRateLimited: (req) => req.limited === true,
    readJson: async (path, fallback) => (files.has(path) ? structuredClone(files.get(path)) : fallback),
    updateJson: async (path, fallback, fn) => {
      const data = files.has(path) ? structuredClone(files.get(path)) : fallback;
      const result = await fn(data);
      if (result === false) return data;
      files.set(path, structuredClone(result === undefined ? data : result));
      return result === undefined ? data : result;
    },
    getBackupFile: (mapId) => `backups/${mapId}.json`,
    LOCK_FILE: 'locks.json',
    stmtExists: { get: (mapId) => maps.has(mapId) },
    loadAndSerialize: async (mapId) => structuredClone(maps.get(mapId) ?? null),
    countCards,
    countMaps: () => mapCount,
    logToMap: async (mapId, text) => { logged.push([mapId, text]); },
    docs,
  };
  registerBackups(ctx);
  registerStats(ctx);
});

const call = async (method, path, { body = {}, limited = false, origin, headers = {} } = {}) => {
  const [key, params] = Object.keys(handlers).map(k => {
    const [m, p] = k.split(' ');
    if (m !== method) return null;
    const match = path.match(new RegExp('^' + p.replace(/:([a-zA-Z]+)/g, '(?<$1>[a-zA-Z0-9_-]+)') + '$'));
    return match ? [k, { ...match.groups }] : null;
  }).find(Boolean) || [];
  assert.ok(key, `no route for ${method} ${path}`);
  const res = { status: null, body: null };
  await handlers[key]({ headers: { host: 'localhost', ...(origin && { origin }), ...headers }, limited }, { writeHead: (s) => { res.status = s; }, end: (b) => { res.body = JSON.parse(b); } }, params, body);
  return res;
};

const backup = (id, timestamp, extra = {}) => ({ id, timestamp, note: '', mapName: 'Old', cardCount: 1, data: JSON.stringify({ name: `Old ${id}` }), ...extra });

// Changes the map, so the next backup isn't a copy of the last one
const rename = (name) => { maps.get('abc12345').name = name; };

describe('backups', () => {
  test('a map starts with no backups', async () => {
    assert.deepEqual((await call('GET', '/api/backups/abc12345')).body, []);
  });

  test('a backup saves the map without its ID, site, lock state or export time', async () => {
    const res = await call('POST', '/api/backups/abc12345', { body: { note: 'Before the workshop' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.note, 'Before the workshop');
    assert.equal(res.body.mapName, 'Small');
    assert.equal(res.body.cardCount, 5);
    const full = (await call('GET', `/api/backups/abc12345/${res.body.id}`)).body;
    const saved = JSON.parse(full.data);
    for (const key of ['id', 'site', 'locked', 'exported']) assert.equal(key in saved, false, key);
    assert.deepEqual(saved.steps, smallMap().steps);
    assert.equal(res.body.size, full.data.length);
  });

  test('a backup from the CLI goes in the activity log, and one from the app is left to the app', async () => {
    await call('POST', '/api/backups/abc12345', { body: { note: 'cli test' } });
    rename('Changed');
    await call('POST', '/api/backups/abc12345', { body: { note: 'From the app' }, origin: 'https://storymaps.io' });
    assert.deepEqual(logged, [['abc12345', 'Created backup']]);
  });

  test('the backup the CLI makes before a restore is left to the restore entry', async () => {
    await call('POST', '/api/backups/abc12345', { body: { note: 'Auto: before restore' } });
    assert.deepEqual(logged, []);
  });

  test('the list shows each backup without its data', async () => {
    await call('POST', '/api/backups/abc12345', { body: { note: 'One' } });
    const [meta] = (await call('GET', '/api/backups/abc12345')).body;
    assert.deepEqual(Object.keys(meta).sort(), ['cardCount', 'id', 'mapName', 'note', 'size', 'timestamp']);
  });

  test('only the newest eight backups are kept', async () => {
    for (let i = 1; i <= 9; i++) {
      rename(`Map ${i}`);
      await call('POST', '/api/backups/abc12345', { body: { note: `Backup ${i}` } });
    }
    const notes = (await call('GET', '/api/backups/abc12345')).body.map(b => b.note);
    assert.deepEqual(notes, ['Backup 2', 'Backup 3', 'Backup 4', 'Backup 5', 'Backup 6', 'Backup 7', 'Backup 8', 'Backup 9']);
  });

  test('backing up a map that does not exist is a 404', async () => {
    assert.equal((await call('POST', '/api/backups/nothere1')).status, 404);
  });

  test('backing up is rate limited', async () => {
    assert.equal((await call('POST', '/api/backups/abc12345', { limited: true })).status, 429);
  });

  test('backing up a map that matches a kept backup adds nothing, and answers with that backup', async () => {
    const first = (await call('POST', '/api/backups/abc12345', { body: { note: 'First' } })).body;
    rename('Changed');
    await call('POST', '/api/backups/abc12345', { body: { note: 'Second' } });
    rename('Small');
    const again = await call('POST', '/api/backups/abc12345', { body: { note: 'Again' } });
    assert.equal(again.status, 200);
    assert.equal(again.body.unchanged, true);
    assert.equal(again.body.id, first.id);
    assert.equal(again.body.note, 'First');
    assert.deepEqual((await call('GET', '/api/backups/abc12345')).body.map(b => b.note), ['First', 'Second']);
    assert.deepEqual(logged, [['abc12345', 'Created backup'], ['abc12345', 'Created backup']], 'the copy is not logged');
  });

  test('backups cannot be deleted', async () => {
    assert.equal(Object.keys(handlers).some(k => k.startsWith('DELETE ')), false);
  });

  test('backing up a locked map needs its password', async () => {
    files.set('locks.json', { abc12345: { isLocked: true, passwordHash: 'hash' } });
    assert.equal((await call('POST', '/api/backups/abc12345')).status, 423);
    assert.deepEqual((await call('GET', '/api/backups/abc12345')).body, []);
    assert.equal((await call('POST', '/api/backups/abc12345', { headers: { 'x-lock-password': 'hash' } })).status, 200);
  });

  test('fetching a backup that does not exist is a 404', async () => {
    assert.equal((await call('GET', '/api/backups/abc12345/0123456789ab')).status, 404);
  });
});

describe('importing backups', () => {
  test('adds backups from an imported file, marked as imported', async () => {
    await call('POST', '/api/backups/abc12345/import', { body: { backups: [backup('aaaaaaaaaaaa', '2026-01-01T00:00:00Z')] } });
    const [meta] = (await call('GET', '/api/backups/abc12345')).body;
    assert.equal(meta.id, 'aaaaaaaaaaaa');
    assert.equal(meta.imported, true);
  });

  test('skips backups it already has and ones with no data', async () => {
    const old = backup('aaaaaaaaaaaa', '2026-01-01T00:00:00Z');
    await call('POST', '/api/backups/abc12345/import', { body: { backups: [old] } });
    await call('POST', '/api/backups/abc12345/import', { body: { backups: [old, { id: 'bbbbbbbbbbbb' }] } });
    assert.deepEqual((await call('GET', '/api/backups/abc12345')).body.map(b => b.id), ['aaaaaaaaaaaa']);
  });

  test('older imported backups do not push out newer ones, like the backup taken just before the import', async () => {
    const { id: beforeImport } = (await call('POST', '/api/backups/abc12345', { body: { note: 'Auto: before import' } })).body;
    const older = Array.from({ length: 8 }, (_, i) => backup(`00000000000${i}`, `2025-0${i + 1}-01T00:00:00Z`));
    await call('POST', '/api/backups/abc12345/import', { body: { backups: older } });
    const ids = (await call('GET', '/api/backups/abc12345')).body.map(b => b.id);
    assert.equal(ids.length, 8);
    assert.ok(ids.includes(beforeImport), 'the backup taken before the import is kept');
  });

  test('newer imported backups replace the oldest ones', async () => {
    const old = Array.from({ length: 8 }, (_, i) => backup(`00000000000${i}`, `2025-0${i + 1}-01T00:00:00Z`));
    await call('POST', '/api/backups/abc12345/import', { body: { backups: old } });
    await call('POST', '/api/backups/abc12345/import', { body: { backups: [backup('ffffffffffff', '2026-06-01T00:00:00Z')] } });
    const ids = (await call('GET', '/api/backups/abc12345')).body.map(b => b.id);
    assert.deepEqual(ids, ['000000000001', '000000000002', '000000000003', '000000000004', '000000000005', '000000000006', '000000000007', 'ffffffffffff']);
  });

  test('skips backups that match one already kept', async () => {
    const { id } = (await call('POST', '/api/backups/abc12345')).body;
    const { data } = (await call('GET', `/api/backups/abc12345/${id}`)).body;
    const copies = [backup('aaaaaaaaaaaa', '2026-01-01T00:00:00Z', { data }), backup('bbbbbbbbbbbb', '2026-01-01T00:00:00Z'), backup('cccccccccccc', '2026-01-02T00:00:00Z', { data: JSON.stringify({ name: 'Old bbbbbbbbbbbb' }) })];
    await call('POST', '/api/backups/abc12345/import', { body: { backups: copies } });
    assert.deepEqual((await call('GET', '/api/backups/abc12345')).body.map(b => b.id).sort(), [id, 'bbbbbbbbbbbb'].sort());
  });

  test('ignores a body without a list of backups', async () => {
    assert.equal((await call('POST', '/api/backups/abc12345/import', { body: { backups: 'nope' } })).status, 200);
    assert.deepEqual((await call('GET', '/api/backups/abc12345')).body, []);
  });
});

describe('stats', () => {
  test('counts the maps in the index and the people on open maps', async () => {
    mapCount = 41;
    const people = (n) => ({ awareness: { getStates: () => new Map(Array.from({ length: n }, (_, i) => [i, {}])) } });
    docs.set('map00001', people(2));
    docs.set('map00002', people(1));
    assert.deepEqual((await call('GET', '/api/stats')).body, { mapCount: 41, activeUsers: 3 });
  });

  test('a page from before the count came from the index can still post, and changes nothing', async () => {
    mapCount = 7;
    assert.deepEqual((await call('POST', '/api/stats')).body, { mapCount: 7 });
    assert.deepEqual((await call('POST', '/api/stats')).body, { mapCount: 7 });
  });
});
