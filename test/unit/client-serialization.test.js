import { describe, test, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import * as Y from 'yjs';
import { state } from '/src/core/state.js';
import { serialize, deserialize, appendImport } from '/src/core/serialization.js';
import { serializeDoc, writeDocFromJson } from '../../server/serialization.js';
import { fullMap, smallMap, samples } from '../fixtures.js';

// serialize() records the site it was exported from
globalThis.window ??= { location: { hostname: 'storymaps.io' } };

const asFile = (map) => ({ app: 'storymap', v: 1, ...map });

// serialize() output without the header fields
const content = () => {
  const { app, v, exported, site, id, ...rest } = serialize();
  return rest;
};

const serverContent = (map) => {
  const doc = new Y.Doc();
  writeDocFromJson(doc, map, Y);
  const { app, v, exported, ...rest } = serializeDoc(doc);
  return rest;
};

beforeEach(() => { state.mapId = null; });

describe('serialize and deserialize', () => {
  test('a map with every field survives a round trip', () => {
    deserialize(asFile(fullMap()));
    assert.deepEqual(content(), fullMap());
  });

  test('serialize adds the app header, export time, site and map ID', () => {
    deserialize(asFile(smallMap()));
    state.mapId = 'abc12345';
    const out = serialize();
    assert.equal(out.app, 'storymap');
    assert.equal(out.v, 1);
    assert.ok(!isNaN(Date.parse(out.exported)));
    assert.equal(out.site, 'storymaps.io');
    assert.equal(out.id, 'abc12345');
  });

  test('the browser and the server serialize the same map the same way', () => {
    deserialize(asFile(fullMap()));
    assert.deepEqual(content(), serverContent(fullMap()));
  });

  for (const { file, data } of samples()) {
    test(`the browser and the server agree on the ${file} sample`, () => {
      deserialize(data);
      assert.deepEqual(content(), serverContent(data));
    });
  }

  test('rejects data that is not a story map', () => {
    assert.throws(() => deserialize({ steps: [], slices: [] }), /Invalid format/);
    assert.throws(() => deserialize(null), /Invalid format/);
  });

  test('rejects a story map in an unknown shape', () => {
    assert.throws(() => deserialize({ app: 'storymap', v: 1, name: 'x' }), /Unknown format/);
  });

  test('reads the legacy compact format', () => {
    deserialize({
      app: 'storymap',
      name: 'Old map',
      a: [{ n: 'Search', c: '#86efac' }, { n: 'Book' }],
      s: [
        { rt: 'Users', t: [[{ n: 'Guest' }], []] },
        { rt: 'Activities', t: [[{ n: 'Find a place' }], [{ n: 'Pay' }]] },
        { n: 'MVP', col: true, t: [[{ n: 'Filter by price', b: 'Slider', c: '#fef08a', u: 'https://example.com/f', h: true, st: 'done', sp: '3', tg: ['search'] }], []] },
      ],
      l: [{ c: '#fecdd3', n: 'Risks' }],
      notes: 'Legacy notes',
    });
    assert.deepEqual(content(), {
      name: 'Old map',
      steps: [{ name: 'Search', color: '#86efac' }, { name: 'Book' }],
      users: [[{ name: 'Guest' }], []],
      activities: [[{ name: 'Find a place' }], [{ name: 'Pay' }]],
      slices: [{
        name: 'MVP',
        collapsed: true,
        stories: [[{ name: 'Filter by price', body: 'Slider', color: '#fef08a', url: 'https://example.com/f', hidden: true, status: 'done', points: 3, tags: ['search'] }], []],
      }],
      legend: [{ color: '#fecdd3', label: 'Risks' }],
      notes: 'Legacy notes',
    });
  });

  test('drops links that are not http or https', () => {
    deserialize(asFile({
      name: 'x',
      steps: [{ name: 'A', url: 'javascript:alert(1)' }, { name: 'B', url: 'ftp://files.example' }, { name: 'C', url: 'https://ok.example/' }],
      slices: [{ name: 'S', stories: [[{ name: 'Card', url: 'data:text/html,hi' }], [], []] }],
    }));
    const out = content();
    assert.deepEqual(out.steps.map(s => s.url), [undefined, undefined, 'https://ok.example/']);
    assert.equal(out.slices[0].stories[0][0].url, undefined);
  });

  test('turns points written as text into numbers', () => {
    deserialize(asFile({ name: 'x', steps: [{ name: 'A', points: '5' }], slices: [] }));
    assert.equal(content().steps[0].points, 5);
  });

  test('drops points that are not a number', () => {
    deserialize(asFile({ name: 'x', steps: [{ name: 'A', points: 'lots' }, { name: 'B', points: '' }, { name: 'C', points: true }], slices: [] }));
    assert.deepEqual(content().steps.map(s => s.points), [undefined, undefined, undefined]);
  });

  test('ignores tags that are not a list', () => {
    deserialize(asFile({ name: 'x', steps: [{ name: 'A', tags: 'ux' }], slices: [] }));
    assert.equal(content().steps[0].tags, undefined);
  });

  test('fills in empty card lists when users, activities or stories are missing', () => {
    deserialize(asFile({ name: 'x', steps: [{ name: 'A' }, { name: 'B' }], slices: [{ name: 'S' }] }));
    const out = content();
    assert.deepEqual(out.users, [[], []]);
    assert.deepEqual(out.activities, [[], []]);
    assert.deepEqual(out.slices[0].stories, [[], []]);
  });
});

describe('appendImport', () => {
  const other = () => asFile({
    name: 'Admin map',
    steps: [{ name: 'Admin' }],
    users: [[{ name: 'Staff' }]],
    activities: [[{ name: 'Manage' }]],
    slices: [
      { name: 'MVP', stories: [[{ name: 'Login' }]] },
      { name: 'Phase 2', stories: [[{ name: 'Reports' }]], goal: 'Self-serve reporting', targetDate: '2027-01-15' },
    ],
    legend: [{ color: '#a5f3fc', label: 'Ignored' }],
    notes: 'Ignored notes',
  });

  test('adds the steps after a hidden spacer and merges slices with the same name', () => {
    deserialize(asFile(smallMap()));
    appendImport(other());
    const out = content();
    assert.deepEqual(out.steps, [{ name: 'Sign up' }, { name: 'Pay' }, { name: '', hidden: true }, { name: 'Admin' }]);
    assert.deepEqual(out.users, [[{ name: 'Visitor' }], [], [], [{ name: 'Staff' }]]);
    assert.deepEqual(out.activities, [[{ name: 'Join' }], [], [], [{ name: 'Manage' }]]);
    assert.deepEqual(out.slices.map(s => s.name), ['MVP', 'Phase 2']);
    assert.deepEqual(out.slices[0].stories, [[{ name: 'Email form' }], [], [], [{ name: 'Login' }]]);
    assert.deepEqual(out.slices[1].stories, [[], [], [], [{ name: 'Reports' }]]);
  });

  test('keeps the current name, legend and notes', () => {
    deserialize(asFile({ ...smallMap(), notes: 'Mine' }));
    appendImport(other());
    const out = content();
    assert.equal(out.name, 'Small');
    assert.deepEqual(out.legend, smallMap().legend);
    assert.equal(out.notes, 'Mine');
  });

  test('adds no spacer to an empty map', () => {
    deserialize(asFile({ name: '', steps: [], slices: [] }));
    appendImport(other());
    assert.deepEqual(content().steps, [{ name: 'Admin' }]);
  });

  test('a new slice keeps its goal and target date', () => {
    deserialize(asFile(smallMap()));
    appendImport(other());
    const phase2 = content().slices[1];
    assert.equal(phase2.goal, 'Self-serve reporting');
    assert.equal(phase2.targetDate, '2027-01-15');
  });

  test('a new slice keeps being collapsed and completed', () => {
    deserialize(asFile(smallMap()));
    appendImport(asFile({ name: 'x', steps: [{ name: 'A' }], slices: [{ name: 'Done', stories: [[]], collapsed: true, closedReason: 'complete' }] }));
    const done = content().slices[1];
    assert.equal(done.collapsed, true);
    assert.equal(done.closedReason, 'complete');
  });

  test('a merged slice keeps its own details', () => {
    deserialize(asFile({ ...smallMap(), slices: [{ name: 'MVP', stories: [[], []], goal: 'Mine' }] }));
    appendImport(asFile({ name: 'x', steps: [{ name: 'A' }], slices: [{ name: 'MVP', stories: [[]], goal: 'Theirs', collapsed: true }] }));
    const [mvp] = content().slices;
    assert.equal(mvp.goal, 'Mine');
    assert.equal(mvp.collapsed, undefined);
  });
});
