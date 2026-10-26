import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseMapId, moveItem, parseLocation, projectPath, MAX_PROJECT_MAPS } from '../../src/core/project-links.js';
import { MAX_PROJECT_MAPS as SERVER_MAX_PROJECT_MAPS } from '../../server/projects.js';

test('reads the map ID from a pasted link or a bare ID', () => {
  assert.equal(parseMapId('https://storymaps.io/abc12345'), 'abc12345');
  assert.equal(parseMapId('  storymaps.io/abc12345  '), 'abc12345');
  assert.equal(parseMapId('http://localhost:3000/abc12345'), 'abc12345');
  assert.equal(parseMapId('https://storymaps.io/abc12345#slice-mvp'), 'abc12345');
  assert.equal(parseMapId('https://storymaps.io/abc12345?x=1'), 'abc12345');
  assert.equal(parseMapId('https://storymaps.io/abc12345/'), 'abc12345');
  assert.equal(parseMapId('abc12345'), 'abc12345');
  assert.equal(parseMapId('https://storymaps.io/p/k8f2m9xq4t/abc12345#slice-mvp'), 'abc12345');
});

test('refuses text that names no single map', () => {
  for (const text of ['', '   ', null, 'https://storymaps.io/', 'https://storymaps.io/sample/coffee',
    'storymaps.io/new', 'tour', 'https://storymaps.io/abc12345.yaml', 'javascript:alert(1)',
    'ftp://storymaps.io/abc12345', 'two words', 'a'.repeat(65), 'https://',
    'storymaps.io/p/k8f2m9xq4t', 'storymaps.io/x/k8f2m9xq4t/abc12345', 'storymaps.io/p/k8f2m9xq4t/new']) {
    assert.equal(parseMapId(text), null, String(text));
  }
});

test('moves one item and leaves the original list alone', () => {
  const list = ['a', 'b', 'c'];
  assert.deepEqual(moveItem(list, 0, 1), ['b', 'a', 'c']);
  assert.deepEqual(moveItem(list, 2, -2), ['c', 'a', 'b']);
  assert.equal(moveItem(list, 0, -1), null);
  assert.equal(moveItem(list, 2, 1), null);
  assert.deepEqual(list, ['a', 'b', 'c']);
});

test('reads the map and project from a page address', () => {
  assert.deepEqual(parseLocation('/abc12345'), { projectId: null, mapId: 'abc12345' });
  assert.deepEqual(parseLocation('/'), { projectId: null, mapId: null });
  assert.deepEqual(parseLocation('/p/k8f2m9xq4t/abc12345'), { projectId: 'k8f2m9xq4t', mapId: 'abc12345' });
  assert.deepEqual(parseLocation('/p/k8f2m9xq4t/new'), { projectId: 'k8f2m9xq4t', mapId: 'new' });
  assert.deepEqual(parseLocation('/p/k8f2m9xq4t'), { projectId: 'k8f2m9xq4t', mapId: null });
  assert.deepEqual(parseLocation('/p/k8f2m9xq4t/'), { projectId: 'k8f2m9xq4t', mapId: null });
  assert.equal(projectPath('k8f2m9xq4t', 'abc12345'), '/p/k8f2m9xq4t/abc12345');
});

test('the app and the server share the same limit on maps in a project', () => {
  assert.equal(MAX_PROJECT_MAPS, SERVER_MAX_PROJECT_MAPS);
});
