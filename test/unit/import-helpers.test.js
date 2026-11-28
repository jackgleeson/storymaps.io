import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildStorymapFromImport, groupTags, legendToAdd } from '/src/transfer/import-helpers.js';
import { CARD_COLORS } from '/src/core/constants.js';
import { state } from '/src/core/state.js';
import { deserialize } from '/src/core/serialization.js';

const buildUrl = (key) => `https://jira.example.com/browse/${key}`;

const epic = (key, summary, stories, extra = {}) => ({ key, summary, _included: true, stories, ...extra });
const story = (key, summary, extra = {}) => ({ key, summary, _included: true, ...extra });
const loose = (stories) => ({ key: null, summary: 'No epic', _included: true, stories });

// Every card in the Imported slice, by column, then read left to right
const columns = (map) => map.slices[1].stories;
const cards = (map) => {
  const cols = columns(map);
  const rows = Math.max(...cols.map(col => col.length));
  return Array.from({ length: rows }, (_, r) => cols.map(col => col[r]).filter(Boolean)).flat();
};

describe('buildStorymapFromImport', () => {
  test('an epic becomes a card in its own colour, followed by its issues, all tagged with its key', () => {
    const map = buildStorymapFromImport([
      epic('ABC-1', 'Checkout', [story('ABC-2', 'Card payment', { labels: ['payments'], status: 'done', points: 3, description: 'Visa and Mastercard' })],
        { description: 'Pay for an order', status: 'in-progress', points: 8 }),
    ], 'Shop', buildUrl);
    const [epicCard, storyCard] = cards(map);
    assert.deepEqual(epicCard, {
      name: 'Checkout', color: CARD_COLORS.lime, tags: ['ABC-1'], body: 'Pay for an order',
      status: 'in-progress', points: 8, url: 'https://jira.example.com/browse/ABC-1',
    });
    assert.deepEqual(storyCard, {
      name: 'Card payment', tags: ['ABC-1', 'payments'], body: 'Visa and Mastercard',
      status: 'done', points: 3, url: 'https://jira.example.com/browse/ABC-2',
    });
  });

  test('issues with no epic come last, with no tag and no epic card', () => {
    const map = buildStorymapFromImport([
      loose([story('A-9', 'Loose')]),
      epic('A-1', 'Epic', [story('A-2', 'Story')]),
    ], 'Shop', buildUrl);
    assert.deepEqual(cards(map).map(c => [c.name, c.tags]), [['Epic', ['A-1']], ['Story', ['A-1']], ['Loose', undefined]]);
    assert.equal(JSON.stringify(map).includes('no-epic'), false);
  });

  test('a group whose key is only an ID is numbered instead', () => {
    const sections = [epic('1201', 'To do', [story('1301', 'Task')]), epic('1202', 'Doing', [story('1302', 'Other task')])];
    const map = buildStorymapFromImport(sections, 'Team', () => '', { group: ['section', 'sections'], item: ['task', 'tasks'], entityName: 'section' });
    assert.deepEqual(cards(map).map(c => c.tags), [['section-01'], ['section-01'], ['section-02'], ['section-02']]);
    assert.deepEqual(map.legend.map(e => e.label), ['Section', 'Task']);
  });

  test('keys from Jira, Linear and Phabricator are used as they are', () => {
    const groups = [epic('COFFEE-3', 'a', []), epic('ENG-12', 'b', []), epic('T123', 'c', []), epic('8f14e45f-ceea-467f-a0e6-1b2c3d4e5f60', 'd', [])];
    assert.deepEqual([...groupTags(groups, 'project').values()], ['COFFEE-3', 'ENG-12', 'T123', 'project-04']);
  });

  test('a prefix says what the key is, and an item tag marks every issue in a group', () => {
    const groups = [epic('T123', 'Parent', [story('T124', 'Child')]), epic(null, 'Other', [story('T125', 'Loose')])];
    assert.deepEqual([...groupTags(groups, 'parent', 'epic').values()], ['epic-T123']);
    groups.forEach(g => { g._included = true; g.stories.forEach(s => { s._included = true; }); });
    groups[0].stories[0].labels = ['frontend'];
    const map = buildStorymapFromImport(groups, 'Phab', () => '', { entityName: 'parent', tagPrefix: 'epic', itemTag: 'subtask' });
    assert.deepEqual(cards(map).map(c => c.tags), [['epic-T123'], ['epic-T123', 'subtask', 'frontend'], undefined]);
  });

  test('an unticked epic is left out but its ticked issues stay, still tagged', () => {
    const map = buildStorymapFromImport([
      epic('A-1', 'Dropped epic', [story('A-2', 'Kept'), story('A-3', 'Dropped', { _included: false })], { _included: false }),
    ], 'Shop', buildUrl);
    assert.deepEqual(cards(map).map(c => [c.name, c.tags]), [['Kept', ['A-1']]]);
    assert.equal('legend' in map, false, 'no legend when there are no epic cards');
  });

  test('leaves out the link when there is none', () => {
    const map = buildStorymapFromImport([epic('A-1', 'Epic', [])], 'Shop', () => null);
    assert.equal('url' in cards(map)[0], false);
  });

  test('spreads the cards across at most 8 columns, left to right', () => {
    const stories = Array.from({ length: 10 }, (_, i) => story(`A-${i + 2}`, `S${i + 1}`));
    const map = buildStorymapFromImport([epic('A-1', 'E', stories)], 'Shop', buildUrl);
    assert.equal(map.steps.length, 8);
    assert.deepEqual(columns(map).map(col => col.map(c => c.name)), [['E', 'S8'], ['S1', 'S9'], ['S2', 'S10'], ['S3'], ['S4'], ['S5'], ['S6'], ['S7']]);
  });

  test('uses one column per card when there are fewer than 8', () => {
    const map = buildStorymapFromImport([epic('A-1', 'E', [story('A-2', 'S')])], 'Shop', buildUrl);
    assert.equal(map.steps.length, 2);
  });

  test('puts every card in a slice called Imported, under an empty slice with no name, with a user, an activity and a legend', () => {
    const map = buildStorymapFromImport([epic('A-1', 'E', [story('A-2', 'S')])], 'Shop', buildUrl);
    assert.equal(map.name, 'Shop Import');
    assert.deepEqual(map.slices.map(s => s.name), ['', 'Imported']);
    assert.deepEqual(map.slices[0].stories, [[], []]);
    assert.equal(map.users[0].length, 1);
    assert.equal(map.activities[0].length, 1);
    assert.deepEqual(map.legend, [{ color: CARD_COLORS.lime, label: 'Epic' }, { color: CARD_COLORS.yellow, label: 'Issue' }]);
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
    assert.deepEqual(state.legend.map(e => e.label), ['Epic', 'Issue']);
  });

  test('added to an open map, the legend gains only the group colour, and only once', () => {
    const { legend } = buildStorymapFromImport([epic('A-1', 'E', [story('A-2', 'S')])], 'Shop', buildUrl);
    const existing = [{ color: CARD_COLORS.blue, label: 'Idea' }];
    assert.deepEqual(legendToAdd(legend, existing), [{ color: CARD_COLORS.lime, label: 'Epic' }]);
    assert.deepEqual(legendToAdd(legend, [...existing, { color: CARD_COLORS.lime, label: 'Risk' }]), []);
    assert.deepEqual(legendToAdd(undefined, existing), []);
  });
});

describe('a big import', () => {
  test('is one of more than 1,000 cards', async () => {
    const { isBigImport, BIG_IMPORT_CARDS } = await import('/src/transfer/import-helpers.js');
    assert.equal(BIG_IMPORT_CARDS, 1000);
    assert.equal(isBigImport(1000), false);
    assert.equal(isBigImport(1001), true);
  });

  test('names issue types in the plural as a tracker writes them', async () => {
    const { pluralType } = await import('/src/transfer/import-helpers.js');
    assert.deepEqual(['Bug', 'Story', 'Sub-task', 'User Story', 'Task', 'Issues'].map(pluralType),
      ['Bugs', 'Stories', 'Sub-tasks', 'User Stories', 'Tasks', 'Issues']);
  });

  test('offers up to three issue types to leave out, smallest first, never the most common', async () => {
    const { trimTypes } = await import('/src/transfer/import-helpers.js');
    assert.deepEqual(trimTypes({ Story: 606, Task: 299, Bug: 241, 'Sub-task': 80 }), ['Sub-task', 'Bug', 'Task']);
    assert.deepEqual(trimTypes({ Story: 600, Bug: 300, 'Sub-task': 200, Task: 50, Spike: 10 }), ['Spike', 'Task', 'Sub-task']);
    // One type, or none, leaves nothing to offer
    assert.deepEqual(trimTypes({ Story: 12 }), []);
    assert.deepEqual(trimTypes({}), []);
  });
});
