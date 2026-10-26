import { test, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';
import { createProjects, ProjectError, MAX_PROJECT_MAPS } from '../../server/projects.js';

let sqlite, projects;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec('CREATE TABLE maps (id TEXT PRIMARY KEY, name TEXT, created_at TEXT, updated_at TEXT)');
  let n = 0;
  projects = createProjects(sqlite, { generateId: () => `p${n++}` });
  const insert = sqlite.prepare("INSERT INTO maps (id, name, created_at, updated_at) VALUES (?, ?, '', '')");
  insert.run('ordering', 'Ordering');
  insert.run('loyalty', 'Loyalty');
  insert.run('barista', 'Barista');
  insert.run('blank', 'untitled');
});

// Close each database when its test ends. On Node 24 the SQLite driver crashes the test process
// at exit if a database with prepared statements is still open.
afterEach(() => sqlite.close());

const ids = (project) => project.maps.map(m => m.id);
const projectCount = () => sqlite.prepare('SELECT COUNT(*) AS n FROM projects').get().n;

const rejects = (fn, status, message) => assert.throws(fn, (err) => {
  assert.ok(err instanceof ProjectError);
  assert.equal(err.status, status);
  if (message) assert.match(err.message, message);
  return true;
});

test('a project starts untitled with its maps in order', () => {
  const project = projects.create(['ordering', 'loyalty']);
  assert.deepEqual(project, {
    id: 'p0',
    name: 'Untitled project',
    maps: [{ id: 'ordering', name: 'Ordering' }, { id: 'loyalty', name: 'Loyalty' }],
  });
  assert.deepEqual(projects.get('p0'), project);
});

test('a project can start with one map and a name, and untitled maps have no name', () => {
  const project = projects.create(['blank'], '  Coffee   App ');
  assert.equal(project.name, 'Coffee App');
  assert.deepEqual(project.maps, [{ id: 'blank', name: '' }]);
  assert.equal(projects.create(['ordering'], '   ').name, 'Untitled project');
  rejects(() => projects.create(['ordering'], 'x'.repeat(101)), 400, /up to/);
});

test('starting a project needs maps the server knows, each once', () => {
  rejects(() => projects.create([]), 400);
  rejects(() => projects.create('ordering'), 400);
  rejects(() => projects.create(['ordering', 'ordering']), 400);
  rejects(() => projects.create(['ordering', 'nope']), 404);
  rejects(() => projects.create(['../etc']), 400);
  assert.equal(projectCount(), 0);
});

test('a map can be in any number of projects, each with its own order', () => {
  const coffee = projects.create(['ordering', 'loyalty']);
  const tutorial = projects.create(['loyalty', 'ordering', 'barista']);
  assert.deepEqual(ids(projects.get(coffee.id)), ['ordering', 'loyalty']);
  assert.deepEqual(ids(projects.get(tutorial.id)), ['loyalty', 'ordering', 'barista']);
  projects.reorder(tutorial.id, ['barista', 'loyalty', 'ordering']);
  assert.deepEqual(ids(projects.get(coffee.id)), ['ordering', 'loyalty']);
  projects.remove(tutorial.id, 'ordering');
  assert.deepEqual(ids(projects.get(coffee.id)), ['ordering', 'loyalty']);
});

test('maps added later go on the end, once each', () => {
  const { id } = projects.create(['ordering']);
  assert.deepEqual(ids(projects.add(id, 'loyalty')), ['ordering', 'loyalty']);
  rejects(() => projects.add(id, 'loyalty'), 409, /already in this project/);
  rejects(() => projects.add(id, 'nope'), 404, /Map not found/);
  rejects(() => projects.add('nope', 'barista'), 404, /Project not found/);
  rejects(() => projects.add(id, 42), 400);
});

test(`a project holds up to ${MAX_PROJECT_MAPS} maps`, () => {
  const insert = sqlite.prepare("INSERT INTO maps (id, name, created_at, updated_at) VALUES (?, 'm', '', '')");
  const many = Array.from({ length: MAX_PROJECT_MAPS }, (_, i) => `m${i}`);
  many.forEach(id => insert.run(id));
  const { id } = projects.create(many);
  rejects(() => projects.add(id, 'ordering'), 400, /up to/);
  rejects(() => projects.create([...many, 'ordering']), 400, /up to/);
  assert.equal(projects.get(id).maps.length, MAX_PROJECT_MAPS);
});

test('removing a map takes it out of that project only, and the last one leaves the project empty', () => {
  const a = projects.create(['ordering', 'loyalty']);
  const b = projects.create(['loyalty']);
  assert.deepEqual(ids(projects.remove(a.id, 'loyalty')), ['ordering']);
  assert.deepEqual(ids(projects.get(b.id)), ['loyalty']);
  assert.ok(sqlite.prepare("SELECT 1 FROM maps WHERE id = 'loyalty'").get());
  rejects(() => projects.remove(a.id, 'loyalty'), 404, /not in this project/);
  assert.deepEqual(projects.remove(a.id, 'ordering').maps, []);
  assert.equal(projects.get(a.id).name, 'Untitled project');
  assert.deepEqual(ids(projects.add(a.id, 'barista')), ['barista']);
  assert.equal(projectCount(), 2);
});

test('deleting a project removes it and its list of maps, and leaves the maps alone', () => {
  const a = projects.create(['ordering', 'loyalty']);
  const b = projects.create(['loyalty']);
  assert.equal(projects.destroy(a.id), null);
  assert.equal(projects.get(a.id), null);
  assert.equal(projects.countForMap('ordering'), 0);
  assert.deepEqual(ids(projects.get(b.id)), ['loyalty']);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM maps').get().n, 4);
  rejects(() => projects.destroy(a.id), 404, /Project not found/);
  rejects(() => projects.destroy('../etc'), 400);
});

test('reordering takes every map in the project exactly once', () => {
  const { id } = projects.create(['ordering', 'loyalty', 'barista']);
  assert.deepEqual(ids(projects.reorder(id, ['barista', 'ordering', 'loyalty'])), ['barista', 'ordering', 'loyalty']);
  rejects(() => projects.reorder(id, ['barista', 'ordering']), 409);
  rejects(() => projects.reorder(id, ['barista', 'ordering', 'ordering']), 409);
  rejects(() => projects.reorder(id, ['barista', 'ordering', 'blank']), 409);
  rejects(() => projects.reorder(id, 'barista'), 409);
  assert.deepEqual(ids(projects.get(id)), ['barista', 'ordering', 'loyalty']);
});

test('renaming cleans the name and refuses an empty or long one', () => {
  const { id } = projects.create(['ordering']);
  assert.equal(projects.rename(id, '  Coffee \n  App ').name, 'Coffee App');
  rejects(() => projects.rename(id, '   '), 400);
  rejects(() => projects.rename(id, 'x'.repeat(101)), 400);
  rejects(() => projects.rename('nope', 'Other'), 404);
  assert.equal(projects.get(id).name, 'Coffee App');
});

test('forgetting a deleted map takes it out of every project, and keeps the projects', () => {
  const a = projects.create(['ordering', 'loyalty']);
  const b = projects.create(['loyalty']);
  assert.equal(projects.countForMap('loyalty'), 2);
  assert.equal(projects.forget('loyalty'), 2);
  assert.deepEqual(ids(projects.get(a.id)), ['ordering']);
  assert.deepEqual(projects.get(b.id).maps, []);
  assert.equal(projects.forget('barista'), 0);
});

test('creating the tables again keeps the projects', () => {
  const { id } = projects.create(['ordering', 'loyalty']);
  createProjects(sqlite, { generateId: () => 'x' });
  assert.deepEqual(ids(projects.get(id)), ['ordering', 'loyalty']);
});
