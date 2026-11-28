import { describe, test, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import * as Y from 'yjs';
import { state, initState, isUntouched } from '/src/core/state.js';
import { serialize, deserialize, appendImport, appendCardsUnderBackbone, backboneSteps } from '/src/core/serialization.js';
import { serializeDoc, writeDocFromJson } from '../../server/serialization.js';
import { fullMap, smallMap, samples } from '../fixtures.js';

// serialize() records the site it was exported from
globalThis.window ??= { location: { hostname: 'storymaps.io', host: 'storymaps.io' } };

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
  test('a user or activity card with no colour gets the colour of its row, which the JSON leaves out', () => {
    deserialize(asFile({ name: 'x', steps: [{ name: 'Browse' }], users: [[{ name: 'Customer' }, { name: 'Barista', color: '#bef264' }]], activities: [[{ name: 'Order', color: '#93c5fd' }]], slices: [{ name: 'MVP', stories: [[{ name: 'List' }]] }] }));
    const [col] = state.columns;
    assert.deepEqual(state.users[col.id].map(c => c.color), ['#fca5a5', '#bef264']);
    assert.equal(state.activities[col.id][0].color, '#93c5fd');
    assert.equal(state.slices[0].stories[col.id][0].color, null);
    assert.deepEqual(content().users, [[{ name: 'Customer' }, { name: 'Barista', color: '#bef264' }]]);
    assert.deepEqual(content().activities, [[{ name: 'Order' }]]);
  });

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

  test('a local server keeps its port in the site, port 3000 included', () => {
    const before = window.location;
    window.location = { hostname: 'localhost', host: 'localhost:3000', port: '3000' };
    try {
      deserialize(asFile(smallMap()));
      assert.equal(serialize().site, 'localhost:3000');
    } finally {
      window.location = before;
    }
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

describe('a story map nobody has worked on', () => {
  test('a new story map is untouched, and its New Step is not a backbone', () => {
    initState();
    assert.equal(isUntouched(), true);
    assert.deepEqual(backboneSteps(), []);
  });

  test('naming the story map, a step or a card, or adding one, makes it someone\'s work', () => {
    const changes = [
      () => { state.name = 'Coffee App'; },
      () => { state.notes = 'Ask about refunds'; },
      () => { state.columns[0].name = 'Browse Menu'; },
      () => { Object.values(state.users)[0][0].name = 'Customer'; },
      () => { Object.values(state.slices[0].stories)[0][0].body = 'As a customer'; },
      () => { Object.values(state.slices[0].stories)[0].push({ name: 'New Task' }); },
      () => { state.slices[0].name = 'MVP'; },
      () => { state.columns.push({ id: 'second', name: 'New Step' }); },
    ];
    for (const change of changes) {
      initState();
      change();
      assert.equal(isUntouched(), false, String(change));
    }
  });

  test('a card cleared of its starter text still counts as untouched', () => {
    initState();
    Object.values(state.activities)[0][0].name = '';
    assert.equal(isUntouched(), true);
  });

  test('a story map with real steps is not untouched', () => {
    deserialize(asFile(smallMap()));
    assert.equal(isUntouched(), false);
    assert.equal(backboneSteps().length, 2);
  });
});

describe('appendCardsUnderBackbone', () => {
  const cards = (...names) => names.map(name => ({ name }));
  const imported = () => content().slices.find(slice => slice.name === 'Imported')?.stories.map(col => col.map(card => card.name));

  test('deals the cards out under the steps that are there, and adds no step', () => {
    deserialize(asFile(smallMap()));
    const before = content();
    assert.equal(appendCardsUnderBackbone(cards('A', 'B', 'C')), true);
    const out = content();
    assert.deepEqual(out.steps, before.steps);
    assert.deepEqual(out.users, before.users);
    assert.deepEqual(out.slices.slice(0, before.slices.length), before.slices);
    assert.deepEqual(imported(), [['A', 'C'], ['B']]);
  });

  test('a second import adds to the same slice', () => {
    deserialize(asFile(smallMap()));
    appendCardsUnderBackbone(cards('A', 'B', 'C'));
    appendCardsUnderBackbone(cards('D'));
    assert.deepEqual(imported(), [['A', 'C', 'D'], ['B']]);
    assert.equal(content().slices.filter(slice => slice.name === 'Imported').length, 1);
  });

  test('steps with no name and hidden spacers are not part of the backbone', () => {
    deserialize(asFile({ name: 'x', steps: [{ name: 'Browse' }, { name: '', hidden: true }, { name: '' }, { name: 'Pay' }], slices: [{ name: 'MVP', stories: [[], [], [], []] }] }));
    assert.deepEqual(backboneSteps().map(step => step.name), ['Browse', 'Pay']);
    appendCardsUnderBackbone(cards('A', 'B', 'C'));
    assert.deepEqual(imported(), [['A', 'C'], [], [], ['B']]);
  });

  test('with no named step, or no cards, nothing changes', () => {
    deserialize(asFile({ name: 'x', steps: [{ name: '' }], slices: [{ name: '', stories: [[]] }] }));
    assert.equal(appendCardsUnderBackbone(cards('A')), false);
    deserialize(asFile(smallMap()));
    assert.equal(appendCardsUnderBackbone([]), false);
    assert.equal(imported(), undefined);
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
