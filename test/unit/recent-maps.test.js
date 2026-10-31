import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readRecent, writeRecent, withEntry, withoutEntry, entryPath, openedAgo, MAX_RECENT, RECENT_KEY } from '../../src/core/recent-maps.js';

const memory = (initial = {}) => {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    data,
  };
};

const map = (id, at = 1) => ({ kind: 'map', id, name: id, at });

test('an opened map goes first, once', () => {
  let list = withEntry([], map('a', 1));
  list = withEntry(list, map('b', 2));
  list = withEntry(list, map('a', 3));
  assert.deepEqual(list.map(e => [e.id, e.at]), [['a', 3], ['b', 2]]);
});

test('a map and a project with the same ID are separate entries', () => {
  const project = { kind: 'project', id: 'a', name: 'P', mapId: 'b', maps: 2, at: 2 };
  const list = withEntry(withEntry([], map('a')), project);
  assert.equal(list.length, 2);
  assert.deepEqual(withoutEntry(list, 'project', 'a'), [map('a')]);
});

test('the list keeps the newest maps only', () => {
  let list = [];
  for (let i = 0; i < MAX_RECENT + 5; i++) list = withEntry(list, map(`m${i}`, i));
  assert.equal(list.length, MAX_RECENT);
  assert.equal(list[0].id, `m${MAX_RECENT + 4}`);
});

test('the list survives a round trip, and anything malformed is dropped', () => {
  const storage = memory();
  writeRecent([map('a'), { kind: 'project', id: 'p', name: 'P', mapId: 'a', maps: 1, at: 5 }], storage);
  assert.equal(readRecent(storage).length, 2);

  storage.setItem(RECENT_KEY, JSON.stringify([map('ok'), { kind: 'map', id: '../x', at: 1 }, { kind: 'project', id: 'p', at: 1 }, null, 'x']));
  assert.deepEqual(readRecent(storage).map(e => e.id), ['ok']);
  storage.setItem(RECENT_KEY, 'not json');
  assert.deepEqual(readRecent(storage), []);

  writeRecent([], storage);
  assert.equal(storage.getItem(RECENT_KEY), null);
});

test('a broken storage never throws', () => {
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); }, removeItem: () => {} };
  assert.deepEqual(readRecent(broken), []);
  writeRecent([map('a')], broken);
});

test('entries open at the map link, or the project link on the last map opened', () => {
  assert.equal(entryPath(map('abc')), '/abc');
  assert.equal(entryPath({ kind: 'project', id: 'p1', mapId: 'abc' }), '/p/p1/abc');
});

test('when a map was opened reads naturally', () => {
  const now = new Date(2026, 9, 30, 15, 0).getTime();
  const at = (d, h = 0, m = 0) => new Date(2026, 9, 30 - d, 15 - h, 0 - m).getTime();
  assert.equal(openedAgo(now - 20_000, now), 'Just now');
  assert.equal(openedAgo(at(0, 0, 5), now), '5 min ago');
  assert.equal(openedAgo(at(0, 3), now), '3h ago');
  assert.equal(openedAgo(at(1), now), 'Yesterday');
  assert.equal(openedAgo(at(4), now), '4 days ago');
  assert.equal(openedAgo(new Date(2026, 9, 12, 9).getTime(), now), '12 Oct');
  assert.equal(openedAgo(new Date(2025, 11, 2).getTime(), now), '2 Dec 2025');
  // Late last night is yesterday, even when it was under 24 hours ago
  assert.equal(openedAgo(new Date(2026, 9, 29, 23, 0).getTime(), new Date(2026, 9, 30, 8, 0).getTime()), 'Yesterday');
});
