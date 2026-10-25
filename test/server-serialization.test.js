import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as Y from 'yjs';
import {
  serializeDoc, writeDocFromJson, diffPush, countCards, contentEtag, appendLogEntry,
} from '../server/serialization.js';
import { fullMap, smallMap } from './fixtures.js';

const writeMap = (data) => {
  const doc = new Y.Doc();
  writeDocFromJson(doc, data, Y);
  return doc;
};

// serializeDoc output without the header fields
const content = (doc) => {
  const { app, v, exported, ...rest } = serializeDoc(doc);
  return rest;
};

describe('writeDocFromJson and serializeDoc', () => {
  test('a map with every field survives a round trip', () => {
    assert.deepEqual(content(writeMap(fullMap())), fullMap());
  });

  test('serializeDoc adds the app header and an export time', () => {
    const out = serializeDoc(writeMap(smallMap()));
    assert.equal(out.app, 'storymap');
    assert.equal(out.v, 1);
    assert.ok(!isNaN(Date.parse(out.exported)));
  });

  test('an empty doc serializes to an empty map', () => {
    assert.deepEqual(content(new Y.Doc()), { name: '', users: [], activities: [], steps: [], slices: [] });
  });

  test('cards past the last step are dropped', () => {
    const doc = writeMap({ name: 'x', steps: [{ name: 'Only' }], users: [[{ name: 'A' }], [{ name: 'B' }]], slices: [{ name: 'S', stories: [[], [{ name: 'Orphan' }]] }] });
    const out = content(doc);
    assert.deepEqual(out.users, [[{ name: 'A' }]]);
    assert.deepEqual(out.slices[0].stories, [[]]);
  });

  test('an empty goal and an invalid date are not stored', () => {
    const doc = writeMap({ name: 'x', steps: [{ name: 'A' }], slices: [{ name: 'S', stories: [[]], goal: '   ', targetDate: 'soon' }] });
    const [slice] = content(doc).slices;
    assert.equal(slice.goal, undefined);
    assert.equal(slice.targetDate, undefined);
  });

  test('a long goal is trimmed and cut to 200 characters', () => {
    const doc = writeMap({ name: 'x', steps: [{ name: 'A' }], slices: [{ name: 'S', stories: [[]], goal: `  ${'g'.repeat(250)}  ` }] });
    assert.equal(content(doc).slices[0].goal, 'g'.repeat(200));
  });

  test('points are stored as numbers, and points that are not a number are dropped', () => {
    const doc = writeMap({
      name: 'x',
      steps: [{ name: 'A', points: '5' }, { name: 'B', points: 'lots' }],
      slices: [{ name: 'S', stories: [[{ name: 'Card', points: '2.5' }], [{ name: 'Other', points: 'many' }]] }],
    });
    const out = content(doc);
    assert.deepEqual(out.steps.map(s => s.points), [5, undefined]);
    assert.deepEqual(out.slices[0].stories.map(c => c[0].points), [2.5, undefined]);
  });

  test('every step, card, slice and legend entry gets its own 8 character ID', () => {
    const json = writeMap(fullMap()).getMap('storymap').toJSON();
    const ids = [
      ...json.columns.map(c => c.id),
      ...Object.values(json.users).flat().map(c => c.id),
      ...Object.values(json.activities).flat().map(c => c.id),
      ...json.slices.map(s => s.id),
      ...json.slices.flatMap(s => Object.values(s.stories).flat().map(c => c.id)),
      ...json.legend.map(e => e.id),
    ];
    assert.ok(ids.every(id => /^[0-9a-z]{8}$/.test(id)), 'all IDs are 8 base36 characters');
    assert.equal(new Set(ids).size, ids.length, 'no duplicates');
  });

  test('tags stored as a plain array (older docs) are read too', () => {
    const doc = new Y.Doc();
    const yCol = new Y.Map();
    yCol.set('id', 'col00001');
    yCol.set('name', 'Step');
    yCol.set('tags', ['legacy']);
    const yColumns = new Y.Array();
    yColumns.push([yCol]);
    doc.getMap('storymap').set('columns', yColumns);
    assert.deepEqual(content(doc).steps, [{ name: 'Step', tags: ['legacy'] }]);
  });

  test('writing again replaces the steps, cards, slices and legend', () => {
    const doc = writeMap(fullMap());
    writeDocFromJson(doc, { name: 'Smaller', steps: [{ name: 'Only' }], slices: [] }, Y);
    const out = content(doc);
    assert.equal(out.name, 'Smaller');
    assert.deepEqual(out.steps, [{ name: 'Only' }]);
    assert.deepEqual(out.users, [[]]);
    assert.deepEqual(out.activities, [[]]);
    assert.deepEqual(out.slices, []);
    assert.equal(out.legend, undefined);
  });

  test('writing a map without a notes key keeps the old notes', () => {
    const doc = writeMap(fullMap());
    writeDocFromJson(doc, smallMap(), Y);
    assert.equal(content(doc).notes, 'Remember the oat milk');
  });

  test('writing empty notes clears them', () => {
    const doc = writeMap(fullMap());
    writeDocFromJson(doc, { ...smallMap(), notes: '' }, Y);
    assert.equal(content(doc).notes, undefined);
  });

  test('writing new notes replaces the old ones', () => {
    const doc = writeMap(fullMap());
    writeDocFromJson(doc, { ...smallMap(), notes: 'Soy milk too' }, Y);
    assert.equal(content(doc).notes, 'Soy milk too');
  });

  test('writing a map without partial maps clears the old ones', () => {
    const doc = writeMap(fullMap());
    writeDocFromJson(doc, smallMap(), Y);
    assert.equal(content(doc).partialMaps, undefined);
  });
});

describe('diffPush', () => {
  // Write a map, then push an edited copy of it the way PUT /api/maps/:id does
  const push = (before, edit) => {
    const doc = writeMap(before);
    const oldSnapshot = serializeDoc(doc);
    const body = structuredClone(oldSnapshot);
    edit(body);
    writeDocFromJson(doc, body, Y);
    return { result: diffPush(oldSnapshot, body, doc), doc };
  };

  test('returns null when nothing changed', () => {
    assert.equal(push(smallMap(), () => {}).result, null);
  });

  test('counts added cards', () => {
    assert.equal(push(smallMap(), b => { b.slices[0].stories[1].push({ name: 'Card form' }); }).result.text, 'Added 1 card');
    assert.equal(push(smallMap(), b => { b.slices[0].stories[1].push({ name: 'A' }, { name: 'B' }); }).result.text, 'Added 2 cards');
  });

  test('counts removed cards', () => {
    assert.equal(push(smallMap(), b => { b.users[0] = []; }).result.text, 'Removed 1 card');
  });

  test('counts removed steps', () => {
    const { result } = push(smallMap(), b => {
      b.steps.pop();
      b.users.pop();
      b.activities.pop();
      b.slices[0].stories.pop();
    });
    assert.equal(result.text, 'Removed 1 step');
  });

  test('lists several changes in one line', () => {
    const { result } = push(smallMap(), b => {
      b.name = 'Renamed';
      b.slices.push({ name: 'Release 2', stories: [[], []] });
    });
    assert.equal(result.text, 'Renamed map, added 1 slice');
  });

  test('renaming a story card says how many cards were renamed', () => {
    assert.equal(push(smallMap(), b => { b.slices[0].stories[0][0].name = 'Sign up form'; }).result.text, 'Renamed 1 card');
  });

  test('editing a story card without renaming it says the slices were edited', () => {
    assert.equal(push(smallMap(), b => { b.slices[0].stories[0][0].color = '#fecdd3'; }).result.text, 'Edited slices');
  });

  test('names the other kinds of edit', () => {
    assert.equal(push(smallMap(), b => { b.steps[0].name = 'Register'; }).result.text, 'Edited steps');
    assert.equal(push(smallMap(), b => { b.users[0][0].name = 'Guest'; }).result.text, 'Edited user cards');
    assert.equal(push(smallMap(), b => { b.activities[0][0].name = 'Enrol'; }).result.text, 'Edited activity cards');
    assert.equal(push(smallMap(), b => { b.legend[0].label = 'Jobs'; }).result.text, 'Edited legend');
    assert.equal(push(smallMap(), b => { b.notes = 'New notes'; }).result.text, 'Edited notes');
  });

  test('leaving out the notes key is not a notes edit', () => {
    assert.equal(push({ ...smallMap(), notes: 'Keep me' }, b => { delete b.notes; }).result, null);
  });

  test('clearing the notes is a notes edit', () => {
    assert.equal(push({ ...smallMap(), notes: 'Clear me' }, b => { b.notes = ''; }).result.text, 'Edited notes');
  });

  test('returns the new IDs of the edited step and story', () => {
    const { result, doc } = push(smallMap(), b => {
      b.steps[1].name = 'Checkout';
      b.slices[0].stories[0][0].name = 'Sign up form';
    });
    const json = doc.getMap('storymap').toJSON();
    const stepId = json.columns[1].id;
    const storyId = json.slices[0].stories[json.columns[0].id][0].id;
    assert.ok(result.ids.includes(stepId), 'includes the step');
    assert.ok(result.ids.includes(storyId), 'includes the story');
  });
});

describe('countCards', () => {
  test('counts named steps and every card', () => {
    assert.equal(countCards(smallMap()), 2 + 1 + 1 + 1);
  });

  test('skips unnamed steps and partial map references', () => {
    assert.equal(countCards({ steps: [{ name: '' }, { partialMapId: 'pm000001' }, { name: 'A' }] }), 1);
  });

  test('a snapshot with missing fields counts as 0', () => {
    assert.equal(countCards({}), 0);
  });
});

describe('contentEtag', () => {
  const base = () => ({ app: 'storymap', v: 1, exported: '2026-10-25T10:00:00Z', name: 'Map', id: 'abc12345', site: 'storymaps.io', locked: false, steps: [] });

  test('is a quoted md5 hash', () => {
    assert.match(contentEtag(base()), /^"[0-9a-f]{32}"$/);
  });

  test('ignores the export time, ID, site, lock and backups', () => {
    const other = { ...base(), exported: '2027-01-01T00:00:00Z', id: 'zzz99999', site: 'localhost', locked: true, backups: [{ ts: 1 }] };
    assert.equal(contentEtag(other), contentEtag(base()));
  });

  test('changes when the content changes', () => {
    assert.notEqual(contentEtag({ ...base(), name: 'Other' }), contentEtag(base()));
  });
});

describe('appendLogEntry', () => {
  test('adds a CLI entry with its text and IDs', () => {
    const doc = new Y.Doc();
    appendLogEntry(doc, 'Created map via CLI', ['abc12345']);
    const [entry] = doc.getArray('log').toJSON();
    assert.equal(entry.src, 'cli');
    assert.equal(entry.text, 'Created map via CLI');
    assert.deepEqual(entry.ids, ['abc12345']);
    assert.equal(typeof entry.ts, 'number');
  });

  test('keeps only the latest 20 entries', () => {
    const doc = new Y.Doc();
    for (let i = 1; i <= 25; i++) appendLogEntry(doc, `Entry ${i}`);
    const log = doc.getArray('log').toJSON();
    assert.equal(log.length, 20);
    assert.equal(log[0].text, 'Entry 6');
    assert.equal(log[19].text, 'Entry 25');
  });
});
