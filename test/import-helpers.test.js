import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildStorymapFromImport } from '/src/transfer/import-helpers.js';
import { CARD_COLORS } from '/src/core/constants.js';
import { state } from '/src/core/state.js';
import { deserialize } from '/src/core/serialization.js';

const buildUrl = (key) => `https://jira.example.com/browse/${key}`;

const epic = (key, summary, stories, extra = {}) => ({ key, summary, _included: true, stories, ...extra });
const story = (key, summary, extra = {}) => ({ key, summary, _included: true, ...extra });

// The import grid: every card in the second slice, by column
const grid = (map) => map.slices[1].stories.map(col => col.map(c => c.name));

describe('buildStorymapFromImport', () => {
  test('turns epics and their stories into tagged cards', () => {
    const map = buildStorymapFromImport([
      epic('ABC-1', 'Checkout', [story('ABC-2', 'Card payment', { labels: ['payments'], status: 'done', points: 3, description: 'Visa and Mastercard' })],
        { description: 'Pay for an order', status: 'in-progress', points: 8 }),
    ], 'Shop', buildUrl);
    const [[epicCard], [storyCard]] = map.slices[1].stories;
    assert.deepEqual(epicCard, {
      name: 'Checkout', color: CARD_COLORS.lime, tags: ['epic-01'], body: 'Pay for an order',
      status: 'in-progress', points: 8, url: 'https://jira.example.com/browse/ABC-1',
    });
    assert.deepEqual(storyCard, {
      name: 'Card payment', tags: ['epic-01-task', 'payments'], body: 'Visa and Mastercard',
      status: 'done', points: 3, url: 'https://jira.example.com/browse/ABC-2',
    });
  });

  test('numbers the epics in order', () => {
    const map = buildStorymapFromImport([
      epic('A-1', 'First', [story('A-2', 'One')]),
      epic('A-3', 'Second', [story('A-4', 'Two')]),
    ], 'Shop', buildUrl);
    const tags = map.slices[1].stories.flat().map(c => c.tags);
    assert.deepEqual(tags, [['epic-01'], ['epic-01-task'], ['epic-02'], ['epic-02-task']]);
  });

  test('stories with no epic get no epic card or tag', () => {
    const map = buildStorymapFromImport([{ summary: 'No epic', _included: true, stories: [story('A-9', 'Loose')] }], 'Shop', buildUrl);
    assert.deepEqual(map.slices[1].stories, [[{ name: 'Loose', url: 'https://jira.example.com/browse/A-9' }]]);
  });

  test('leaves out epics and stories that were unticked', () => {
    const map = buildStorymapFromImport([
      epic('A-1', 'Kept', [story('A-2', 'Kept story'), story('A-3', 'Dropped story', { _included: false })]),
      epic('A-4', 'Dropped', [story('A-5', 'Story of a dropped epic')], { _included: false }),
    ], 'Shop', buildUrl);
    assert.deepEqual(map.slices[1].stories.flat().map(c => c.name), ['Kept', 'Kept story']);
  });

  test('leaves out the link when there is none', () => {
    const map = buildStorymapFromImport([epic('A-1', 'Epic', [])], 'Shop', () => null);
    assert.equal('url' in map.slices[1].stories[0][0], false);
  });

  test('spreads the cards across at most 8 columns, left to right', () => {
    const stories = Array.from({ length: 10 }, (_, i) => story(`A-${i + 2}`, `S${i + 1}`));
    const map = buildStorymapFromImport([epic('A-1', 'E', stories)], 'Shop', buildUrl);
    assert.equal(map.steps.length, 8);
    assert.deepEqual(grid(map), [['E', 'S8'], ['S1', 'S9'], ['S2', 'S10'], ['S3'], ['S4'], ['S5'], ['S6'], ['S7']]);
  });

  test('uses one column per card when there are fewer than 8', () => {
    const map = buildStorymapFromImport([epic('A-1', 'E', [story('A-2', 'S')])], 'Shop', buildUrl);
    assert.equal(map.steps.length, 2);
  });

  test('adds an empty MVP slice above the imported cards, plus a user and an activity', () => {
    const map = buildStorymapFromImport([epic('A-1', 'E', [story('A-2', 'S')])], 'Shop', buildUrl);
    assert.equal(map.name, 'Shop Import');
    assert.deepEqual(map.slices.map(s => s.name), ['MVP', 'IMPORTED: Epics & stories']);
    assert.deepEqual(map.slices[0].stories, [[], []]);
    assert.equal(map.users[0].length, 1);
    assert.equal(map.activities[0].length, 1);
  });

  test('the entity name and slice label can be changed', () => {
    const map = buildStorymapFromImport([epic('P-1', 'Project', [story('P-2', 'Task')])], 'Team', buildUrl,
      { entityName: 'project', sliceLabel: 'IMPORTED: Projects' });
    assert.equal(map.slices[1].name, 'IMPORTED: Projects');
    assert.deepEqual(map.slices[1].stories[0][0].tags, ['project-01']);
  });

  test('nothing to import gives an empty map', () => {
    assert.deepEqual(buildStorymapFromImport([], 'Shop', buildUrl), {
      app: 'storymap', v: 1, name: 'Shop Import', steps: [], users: [], activities: [], slices: [],
    });
  });

  test('the result loads as a story map', () => {
    const map = buildStorymapFromImport([epic('A-1', 'E', [story('A-2', 'S')])], 'Shop', buildUrl);
    deserialize(map);
    assert.equal(state.columns.length, 2);
    assert.equal(state.slices.length, 2);
  });
});
