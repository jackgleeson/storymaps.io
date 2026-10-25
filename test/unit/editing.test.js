import { describe, test, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

// Editing operations change the map state, then ask for a render and look for the new card to
// scroll to. Stub the page so they run without one; there's never an element to scroll to.
const fakeElement = () => ({ value: '', querySelector: () => null, querySelectorAll: () => [] });
globalThis.document ??= { getElementById: () => fakeElement() };
globalThis.window ??= { location: { hostname: 'storymaps.io' } };
window.matchMedia ??= () => ({ matches: false, addEventListener() {} });
globalThis.requestAnimationFrame ??= () => 0;
const memoryStorage = () => {
  const items = new Map();
  return { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => items.set(k, String(v)), removeItem: (k) => items.delete(k) };
};
globalThis.localStorage ??= memoryStorage();
globalThis.sessionStorage ??= memoryStorage();

const { state, selection, clearSelection, pushUndo, undo, clearUndoHistory, init: initState } = await import('/src/core/state.js');
const { serialize, deserialize } = await import('/src/core/serialization.js');
const render = await import('/src/ui/render.js');

let renders = 0;
const logged = [];
render.init({
  state,
  isMapEditable: () => true,
  pushUndo,
  saveToStorage() {},
  renderAndSave: () => { renders++; },
  scrollElementIntoView() {},
  logEvent: (text) => logged.push(text),
});
initState({ serialize, deserialize, renderAndSave: () => { renders++; }, logEvent: () => {} });

const map = () => ({
  app: 'storymap', v: 1, name: 'Shop',
  steps: [{ name: 'Browse' }, { name: 'Pay', tags: ['money'] }, { partialMapId: 'pm000001', partialMapOrigin: true }],
  users: [[{ name: 'Guest' }], [], []],
  activities: [[{ name: 'Find' }], [{ name: 'Checkout' }], []],
  slices: [
    { name: 'MVP', stories: [[{ name: 'List' }, { name: 'Filter' }], [{ name: 'Card' }], []] },
    { name: 'Later', stories: [[{ name: 'Wishlist' }], [], []] },
  ],
  partialMaps: [{ id: 'pm000001', name: 'Login', users: [[]], activities: [[]], steps: [{ name: 'Sign in' }], stories: [[[]], [[]]] }],
});

// Card names by column, for a slice or a backbone row
const col = (i) => state.columns[i].id;
const names = (cards) => (cards || []).map(c => c.name);
const sliceNames = (s) => state.columns.map(c => names(state.slices[s].stories[c.id]));
const ids = (list) => list.map(c => c.id);

beforeEach(() => {
  deserialize(map());
  clearSelection();
  clearUndoHistory();
  renders = 0;
  logged.length = 0;
});

describe('adding', () => {
  test('addColumn adds an empty column at the end with a card list in every row', () => {
    render.addColumn(false);
    const added = state.columns.at(-1);
    assert.equal(state.columns.length, 4);
    assert.equal(added.hidden, false);
    assert.deepEqual(state.users[added.id], []);
    assert.deepEqual(state.activities[added.id], []);
    assert.ok(state.slices.every(s => Array.isArray(s.stories[added.id])));
    assert.deepEqual(logged, ['Added step']);
  });

  test('addColumnAt inserts a column at the position given', () => {
    render.addColumnAt(1);
    assert.deepEqual(state.columns.map(c => c.name), ['Browse', '', 'Pay', '']);
    assert.ok(state.slices.every(s => Array.isArray(s.stories[col(1)])));
  });

  test('addStory adds a blank card to a slice, the users row or the activities row', () => {
    render.addStory(col(1), state.slices[0].id);
    render.addStory(col(1), null, 'users');
    render.addStory(col(1), null, 'activities');
    assert.deepEqual(names(state.slices[0].stories[col(1)]), ['Card', '']);
    assert.deepEqual(names(state.users[col(1)]), ['']);
    assert.deepEqual(names(state.activities[col(1)]), ['Checkout', '']);
    assert.deepEqual(logged, ['Added card', 'Added user card', 'Added activity card']);
  });

  test('addStory to a slice that no longer exists changes nothing, and adds nothing to undo', () => {
    state.name = 'Before';
    render.addStory(col(0), 'gone0001');
    state.name = 'After';
    undo();
    assert.equal(state.name, 'After');
    assert.equal(renders, 0);
  });

  test('addSlice inserts a slice with a card list for every step', () => {
    const slice = render.addSlice(1, { name: 'Release 2', openDetails: false });
    assert.deepEqual(state.slices.map(s => s.name), ['MVP', 'Release 2', 'Later']);
    assert.deepEqual(Object.keys(slice.stories), state.columns.map(c => c.id));
  });
});

describe('deleting', () => {
  test('deleteStory removes the card', () => {
    const [list] = state.slices[0].stories[col(0)];
    render.deleteStory(col(0), state.slices[0].id, list.id);
    assert.deepEqual(names(state.slices[0].stories[col(0)]), ['Filter']);
    assert.deepEqual(logged, ['Deleted card "List"']);
  });

  test('deleteStory removes user and activity cards', () => {
    render.deleteStory(col(0), null, state.users[col(0)][0].id, 'users');
    render.deleteStory(col(1), null, state.activities[col(1)][0].id, 'activities');
    assert.deepEqual(state.users[col(0)], []);
    assert.deepEqual(state.activities[col(1)], []);
  });

  test('deleteStory with an unknown card changes nothing', () => {
    render.deleteStory(col(0), state.slices[0].id, 'nothere1');
    assert.equal(renders, 0);
  });

  test('deleteSlice removes a slice but never the last one', () => {
    render.deleteSlice(state.slices[1].id);
    assert.deepEqual(state.slices.map(s => s.name), ['MVP']);
    render.deleteSlice(state.slices[0].id);
    assert.deepEqual(state.slices.map(s => s.name), ['MVP']);
  });

  test('deleteColumn removes a step and all its cards', async () => {
    const payId = col(1);
    await render.deleteColumn(payId);
    assert.deepEqual(state.columns.map(c => c.name), ['Browse', '']);
    assert.equal(state.users[payId], undefined);
    assert.equal(state.activities[payId], undefined);
    assert.ok(state.slices.every(s => !(payId in s.stories)));
  });
});

describe('moving cards', () => {
  test('moveStory reorders a card within its column', () => {
    const filter = state.slices[0].stories[col(0)][1];
    render.moveStory(filter.id, col(0), state.slices[0].id, col(0), state.slices[0].id, 0);
    assert.deepEqual(names(state.slices[0].stories[col(0)]), ['Filter', 'List']);
  });

  test('moveStory moves a card to another column and slice', () => {
    const list = state.slices[0].stories[col(0)][0];
    render.moveStory(list.id, col(0), state.slices[0].id, col(1), state.slices[1].id, 0);
    assert.deepEqual(sliceNames(0), [['Filter'], ['Card'], []]);
    assert.deepEqual(sliceNames(1), [['Wishlist'], ['List'], []]);
    assert.equal(state.slices[1].stories[col(1)][0], list, 'the same card, not a copy');
  });

  test('moveStory moves a user card into a slice', () => {
    const guest = state.users[col(0)][0];
    render.moveStory(guest.id, col(0), null, col(1), state.slices[0].id, 1, 'users', null);
    assert.deepEqual(state.users[col(0)], []);
    assert.deepEqual(names(state.slices[0].stories[col(1)]), ['Card', 'Guest']);
  });

  test('moving a card to a slice that no longer exists keeps the card where it was', () => {
    const list = state.slices[0].stories[col(0)][0];
    render.moveStory(list.id, col(0), state.slices[0].id, col(1), 'gone0001', 0);
    assert.deepEqual(names(state.slices[0].stories[col(0)]), ['List', 'Filter']);
    assert.equal(renders, 1, 'redraws so the dragged card goes back');
  });

  test('moving a card that is not there changes nothing, and adds nothing to undo', () => {
    state.name = 'Before';
    render.moveStory('nothere1', col(0), state.slices[0].id, col(1), state.slices[0].id, 0);
    state.name = 'After';
    undo();
    assert.equal(state.name, 'After');
  });

  test('getMultiDragIds returns the selected cards when the dragged card is one of them', () => {
    const [a, b] = state.slices[0].stories[col(0)];
    selection.clickedCards = [{ type: 'story', storyId: a.id }, { type: 'story', storyId: b.id }, { type: 'step', columnId: col(0) }];
    assert.deepEqual(render.getMultiDragIds(a.id), [a.id, b.id]);
    assert.equal(render.getMultiDragIds('other001'), null);
    selection.clickedCards = [{ type: 'story', storyId: a.id }];
    assert.equal(render.getMultiDragIds(a.id), null, 'one card is a normal drag');
  });

  test('moveSelectedStories stacks the cards in map reading order where they were dropped', () => {
    const wishlist = state.slices[1].stories[col(0)][0];
    const card = state.slices[0].stories[col(1)][0];
    const guest = state.users[col(0)][0];
    const list = state.slices[0].stories[col(0)][0];
    // Dropped in Later / Pay, which is empty, so there's no card after the drop point
    const dropped = { nextElementSibling: null };
    const moved = render.moveSelectedStories([wishlist.id, card.id, guest.id, list.id], dropped, col(1), state.slices[1].id);
    assert.equal(moved, true);
    assert.deepEqual(names(state.slices[1].stories[col(1)]), ['Guest', 'List', 'Card', 'Wishlist']);
    assert.deepEqual(state.users[col(0)], []);
    assert.deepEqual(selection.clickedCards.map(c => c.storyId), ids([guest, list, card, wishlist]), 'the cards stay selected');
  });

  test('moveSelectedStories inserts before the first card after the drop point that is not moving', () => {
    const [list, filter] = state.slices[0].stories[col(0)];
    const card = state.slices[0].stories[col(1)][0];
    const dropped = { nextElementSibling: { dataset: { storyId: filter.id }, nextElementSibling: null } };
    render.moveSelectedStories([list.id, card.id], dropped, col(0), state.slices[0].id);
    assert.deepEqual(names(state.slices[0].stories[col(0)]), ['List', 'Card', 'Filter']);
  });
});

describe('duplicating', () => {
  test('duplicateColumns copies the steps and their cards after the last selected step', () => {
    render.duplicateColumns([col(0), col(1)]);
    assert.deepEqual(state.columns.map(c => c.name), ['Browse', 'Pay', 'Browse', 'Pay', '']);
    assert.deepEqual(sliceNames(0), [['List', 'Filter'], ['Card'], ['List', 'Filter'], ['Card'], []]);
    assert.deepEqual(names(state.users[col(2)]), ['Guest']);
    assert.deepEqual(names(state.activities[col(3)]), ['Checkout']);
    assert.deepEqual(logged, ['Duplicated 2 steps']);
  });

  test('copies get new IDs and their own tags', () => {
    render.duplicateColumns([col(1)]);
    const [original, copy] = [state.columns[1], state.columns[2]];
    assert.notEqual(copy.id, original.id);
    assert.notEqual(state.slices[0].stories[copy.id][0].id, state.slices[0].stories[original.id][0].id);
    copy.tags.push('copy-only');
    assert.deepEqual(original.tags, ['money']);
  });

  test('partial map references are not duplicated', () => {
    render.duplicateColumns([col(2)]);
    assert.equal(state.columns.length, 3);
    assert.equal(renders, 0);
  });

  test('duplicateCards copies the selected cards into a new hidden column after them', () => {
    const [list] = state.slices[0].stories[col(0)];
    const guest = state.users[col(0)][0];
    selection.clickedCards = [
      { type: 'story', columnId: col(0), storyId: list.id, sliceId: state.slices[0].id },
      { type: 'story', columnId: col(0), storyId: guest.id, rowType: 'users' },
    ];
    render.duplicateCards();
    const copyCol = state.columns[1];
    assert.equal(copyCol.hidden, true);
    assert.deepEqual(names(state.slices[0].stories[copyCol.id]), ['List']);
    assert.deepEqual(names(state.users[copyCol.id]), ['Guest']);
    assert.deepEqual(state.slices[1].stories[copyCol.id], []);
    assert.deepEqual(logged, ['Duplicated 2 cards']);
  });

  test('duplicateCards with a step selected copies the step too', () => {
    selection.clickedCards = [{ type: 'step', columnId: col(1) }];
    render.duplicateCards();
    assert.deepEqual(state.columns.map(c => c.name), ['Browse', 'Pay', 'Pay', '']);
    assert.equal(state.columns[2].hidden, false);
  });
});
