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
  assert.deepEqual(started, { id: started.id, name: 'Untitled project', locked: false, maps: [{ id: a, name: 'Ordering' }, { id: b, name: 'Loyalty' }] });
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

test('the CLI can start a project, add maps, check the password and lock, but nothing else', async () => {
  const [a, b] = [await newMap('A'), await newMap('B')];
  const cli = { origin: null };
  const started = await call('POST', '/api/projects', { mapIds: [a], name: 'From the CLI' }, cli);
  assert.equal(started.status, 201);
  const id = started.json.project.id;
  assert.equal((await call('POST', `/api/projects/${id}/maps`, { mapId: b }, cli)).status, 200);
  const hash = 'c'.repeat(64);
  const locked = await call('POST', `/api/projects/${id}/lock`, { passwordHash: hash, lockMaps: true }, cli);
  assert.equal(locked.status, 200);
  assert.deepEqual(locked.json.project.maps.map(m => m.lock), ['project', 'project']);
  assert.equal((await call('POST', `/api/projects/${id}/unlock`, { passwordHash: hash }, cli)).status, 200);
  assert.equal((await call('POST', `/api/projects/${id}/unlock`, { passwordHash: 'd'.repeat(64) }, cli)).status, 403);
  // Renaming, reordering, removing and deleting stay in the app
  for (const [path, body] of [['name', { name: 'X' }], ['order', { mapIds: [b, a] }], ['remove', { mapId: a }], ['delete', {}], ['map-lock', { mapId: a, action: 'unlock', passwordHash: hash }]]) {
    assert.equal((await call('POST', `/api/projects/${id}/${path}`, { ...body, lockPasswordHash: hash }, cli)).status, 403, path);
  }
  assert.equal((await call('POST', `/api/projects/${id}/lock/remove`, { passwordHash: hash, removeMaps: true }, cli)).status, 200);
  assert.equal((await project(id)).json.project.locked, false);
  // Another site is still refused everywhere
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

test('format extensions work at the end of a project link, the same as on a map link', async () => {
  const a = await newMap('Format map');
  const { id } = await start(a);
  const text = async (path) => {
    const res = await fetch(server.base + path);
    return { status: res.status, type: res.headers.get('content-type'), body: await res.text() };
  };
  for (const ext of ['yaml', 'json', 'csv']) {
    const viaProject = await text(`/p/${id}/${a}.${ext}`);
    const plain = await text(`/${a}.${ext}`);
    assert.equal(viaProject.status, 200, ext);
    assert.equal(viaProject.type, plain.type, ext);
    // JSON and CSV carry the time they were read, so compare them without it. Through the project
    // link, YAML and JSON also say which project; CSV carries no IDs at all.
    const strip = (body) => ext === 'json'
      ? JSON.stringify({ ...JSON.parse(body), exported: null, project: undefined })
      : body.replace(/^# \d{4}-\d{2}-\d{2}T[\d:.]+Z,*$/m, '').replace(`project: ${id}\n`, '');
    assert.equal(strip(viaProject.body), strip(plain.body), ext);
  }
  // The project key sits straight after the map ID, and a plain link never has one
  assert.match((await text(`/p/${id}/${a}.yaml`)).body, new RegExp(`^name: Format map\nid: ${a}\nproject: ${id}\n`));
  assert.deepEqual(Object.keys(JSON.parse((await text(`/p/${id}/${a}.json`)).body)).slice(4, 6), ['id', 'project']);
  assert.doesNotMatch((await text(`/${a}.yaml`)).body, /^project:/m);
  // A map that isn't in the project isn't served through its link
  const outside = await newMap('Outside');
  assert.equal((await text(`/p/${id}/${outside}.yaml`)).status, 404);
  assert.equal((await text(`/p/${id}/zzzzzzzz.yaml`)).status, 404);
  assert.equal((await text(`/p/${id}/${a}/extra.yaml`)).status, 404);
});

test('the CLI pulls a map through its project with the project key, and the same ETag', async () => {
  const [a, outside] = [await newMap('Pulled'), await newMap('Outside')];
  const { id } = await start(a);
  const get = (path) => fetch(server.base + path);
  const plain = await get(`/api/maps/${a}?format=yaml`);
  const viaProject = await get(`/api/maps/${a}?format=yaml&project=${id}`);
  assert.equal(viaProject.status, 200);
  assert.match(await viaProject.text(), new RegExp(`^name: Pulled\nid: ${a}\nproject: ${id}\n`));
  assert.doesNotMatch(await plain.text(), /^project:/m);
  // Being in a project isn't an edit, so the conflict check sees the same map either way
  assert.equal(viaProject.headers.get('etag'), plain.headers.get('etag'));
  const json = await (await get(`/api/maps/${a}?project=${id}`)).json();
  assert.equal(json.project, id);
  assert.equal((await get(`/api/maps/${outside}?format=yaml&project=${id}`)).status, 404);
  // A YAML file with the key pushes like any other, and the key isn't stored on the map
  const yaml = await (await get(`/api/maps/${a}?format=yaml&project=${id}`)).text();
  const pushed = await fetch(`${server.base}/api/maps/${a}`, { method: 'PUT', headers: { 'Content-Type': 'text/yaml', 'X-Forwarded-For': '10.9.9.9' }, body: yaml });
  assert.equal(pushed.status, 200);
  assert.doesNotMatch(await (await get(`/api/maps/${a}?format=yaml`)).text(), /^project:/m);
});

test('projects are kept when the server restarts', async () => {
  const [a, b] = [await newMap('Kept'), await newMap('Also kept')];
  const { id } = await start(a, b);
  await server.stop();
  server = await startServer(dataDir);
  assert.deepEqual(ids((await project(id)).json.project), [a, b]);
});
