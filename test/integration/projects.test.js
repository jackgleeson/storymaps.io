import { test, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { smallMap } from '../fixtures.js';
import { startServer } from './server-process.js';

const ORIGIN = 'http://localhost:3000';
let server, dataDir;

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'storymaps-projects-'));
  server = await startServer(dataDir);
});

after(async () => {
  await server.stop();
  await rm(dataDir, { recursive: true, force: true });
});

// Each test request comes from its own address, so the per-address limits never decide a test
let address = 0;
const call = async (method, path, body, { origin = ORIGIN } = {}) => {
  const headers = { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.0.${Math.floor(address / 250)}.${address++ % 250}` };
  if (origin) headers.origin = origin;
  const res = await fetch(server.base + path, { method, headers, body: body && JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};

const newMap = async (name) => {
  const res = await call('POST', '/api/maps', { ...smallMap(), name });
  assert.equal(res.status, 201);
  return res.json.id;
};
const project = async (id) => call('GET', `/api/projects/${id}`);
const ids = (p) => p.maps.map(m => m.id);
const start = async (...mapIds) => {
  const res = await call('POST', '/api/projects', { mapIds });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json.project;
};

test('a project is started, added to, reordered, renamed and emptied', async () => {
  const [a, b, c] = [await newMap('Ordering'), await newMap('Loyalty'), await newMap('Barista')];
  const started = await start(a, b);
  assert.match(started.id, /^[a-z0-9]{8}$/);
  assert.deepEqual(started, { id: started.id, name: 'Untitled project', maps: [{ id: a, name: 'Ordering' }, { id: b, name: 'Loyalty' }] });
  const id = started.id;

  let res = await call('POST', `/api/projects/${id}/maps`, { mapId: c });
  assert.deepEqual(ids(res.json.project), [a, b, c]);
  res = await call('POST', `/api/projects/${id}/order`, { mapIds: [c, a, b] });
  assert.deepEqual(ids(res.json.project), [c, a, b]);
  res = await call('POST', `/api/projects/${id}/name`, { name: 'Coffee App' });
  assert.equal(res.json.project.name, 'Coffee App');
  assert.equal((await project(id)).json.project.name, 'Coffee App');

  for (const mapId of [a, b]) await call('POST', `/api/projects/${id}/remove`, { mapId });
  res = await call('POST', `/api/projects/${id}/remove`, { mapId: c });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.project.maps, []);
  assert.equal((await project(id)).json.project.name, 'Coffee App');

  res = await call('POST', `/api/projects/${id}/delete`);
  assert.equal(res.status, 200);
  assert.equal(res.json.project, null);
  assert.equal((await project(id)).status, 404);
  assert.equal((await call('POST', `/api/projects/${id}/delete`)).status, 404);
  for (const mapId of [a, b, c]) assert.equal((await call('GET', `/api/maps/${mapId}`)).status, 200);
});

test('a map can be in two projects, each with its own order', async () => {
  const [a, b] = [await newMap('Shared'), await newMap('Other')];
  const first = await start(a, b);
  const second = await start(b, a);
  await call('POST', `/api/projects/${second.id}/remove`, { mapId: a });
  assert.deepEqual(ids((await project(first.id)).json.project), [a, b]);
  assert.deepEqual(ids((await project(second.id)).json.project), [b]);
});

test('project changes never change what is on a map', async () => {
  const [a, b] = [await newMap('First'), await newMap('Second')];
  const pull = async (id) => {
    const { exported, ...map } = (await call('GET', `/api/maps/${id}`)).json;
    return map;
  };
  const before = [await pull(a), await pull(b)];
  const { id } = await start(a);
  await call('POST', `/api/projects/${id}/maps`, { mapId: b });
  await call('POST', `/api/projects/${id}/order`, { mapIds: [b, a] });
  await call('POST', `/api/projects/${id}/name`, { name: 'Renamed' });
  await call('POST', `/api/projects/${id}/remove`, { mapId: b });
  await call('POST', `/api/projects/${id}/remove`, { mapId: a });
  await call('POST', `/api/projects/${id}/maps`, { mapId: a });
  await call('POST', `/api/projects/${id}/delete`);
  assert.deepEqual([await pull(a), await pull(b)], before);
});

test('refused changes say why', async () => {
  const [a, b] = [await newMap('A'), await newMap('B')];
  const { id } = await start(a, b);
  assert.equal((await call('POST', '/api/projects', { mapIds: ['zzzzzzzz'] })).status, 404);
  assert.equal((await call('POST', '/api/projects', {})).status, 400);
  assert.equal((await call('POST', '/api/projects', { mapIds: [a], name: 'x'.repeat(101) })).status, 400);
  const named = await call('POST', '/api/projects', { mapIds: [a], name: 'Coffee App' });
  assert.equal(named.json.project.name, 'Coffee App');
  assert.equal((await call('POST', `/api/projects/${id}/maps`, { mapId: b })).status, 409);
  assert.equal((await call('POST', `/api/projects/${id}/maps`, { mapId: 'zzzzzzzz' })).status, 404);
  assert.equal((await call('POST', `/api/projects/${id}/order`, { mapIds: [a] })).status, 409);
  assert.equal((await call('POST', `/api/projects/${id}/name`, { name: ' ' })).status, 400);
  assert.equal((await call('POST', '/api/projects/nope123456/maps', { mapId: a })).status, 404);
  assert.equal((await project('nope123456')).status, 404);
  assert.deepEqual(ids((await project(id)).json.project), [a, b]);
});

test('changes are only taken from the site itself', async () => {
  const a = await newMap('A');
  assert.equal((await call('POST', '/api/projects', { mapIds: [a] }, { origin: null })).status, 403);
  assert.equal((await call('POST', '/api/projects', { mapIds: [a] }, { origin: 'https://evil.example' })).status, 403);
});

test('project links serve the app, and other paths under /p do not', async () => {
  const a = await newMap('A');
  const { id } = await start(a);
  for (const path of [`/p/${id}`, `/p/${id}/`, `/p/${id}/${a}`, `/p/${id}/${a}/`, `/p/${id}/new`]) {
    const res = await fetch(server.base + path);
    assert.equal(res.status, 200, path);
    assert.match(await res.text(), /<html/, path);
  }
  for (const path of [`/p/${id}/${a}/extra`, '/p/']) {
    assert.equal((await fetch(server.base + path)).status, 404, path);
  }
});

test('projects are kept when the server restarts', async () => {
  const [a, b] = [await newMap('Kept'), await newMap('Also kept')];
  const { id } = await start(a, b);
  await server.stop();
  server = await startServer(dataDir);
  assert.deepEqual(ids((await project(id)).json.project), [a, b]);
});
