import { describe, test, beforeEach, afterEach, mock } from 'node:test';
import { strict as assert } from 'node:assert';

// Undo and redo look up the board name, the map and the toolbar buttons by ID
const elements = {};
const fakeElement = () => ({ value: '', disabled: true, querySelector: () => null, querySelectorAll: () => [] });
globalThis.document = { getElementById: (id) => (elements[id] ??= fakeElement()) };
globalThis.window ??= { location: { hostname: 'storymaps.io' } };

const { state, init, initState, hasContent, createSlice, createStory, pushUndo, undo, redo, clearUndoHistory } = await import('/src/core/state.js');
const { serialize, deserialize } = await import('/src/core/serialization.js');

let renders = 0;
const logged = [];
init({ serialize, deserialize, renderAndSave: () => { renders++; }, logEvent: (text) => logged.push(text) });

const emptyState = () => {
  Object.assign(state, { name: '', columns: [], users: {}, activities: {}, slices: [], legend: [], notes: '', partialMaps: [] });
};

describe('hasContent', () => {
  beforeEach(emptyState);

  test('an empty map has no content', () => {
    assert.equal(hasContent(), false);
  });

  test('unnamed steps and slices on their own are not content', () => {
    initState();
    state.columns[0].name = '';
    state.users = {};
    state.activities = {};
    state.slices = [createSlice()];
    assert.equal(hasContent(), false);
  });

  test('a map name, named step, card, named slice or partial map is content', () => {
    const cases = {
      'map name': () => { state.name = 'Mine'; },
      'named step': () => { initState(); },
      'user card': () => { state.users = { a: [createStory('Guest')] }; },
      'story card': () => { state.slices = [{ id: 's', name: '', stories: { a: [createStory('')] } }]; },
      'named slice': () => { state.slices = [{ id: 's', name: 'MVP', stories: {} }]; },
      'partial map': () => { state.partialMaps = [{ id: 'p' }]; },
    };
    for (const [label, setup] of Object.entries(cases)) {
      emptyState();
      setup();
      assert.equal(hasContent(), true, label);
    }
  });
});

describe('initState', () => {
  test('starts a map with one step, a user, an activity, a story and the default legend', () => {
    initState();
    assert.equal(state.name, '');
    assert.equal(state.columns.length, 1);
    const [col] = state.columns;
    assert.equal(col.name, 'New Step');
    assert.equal(state.users[col.id].length, 1);
    assert.equal(state.activities[col.id].length, 1);
    assert.equal(state.slices.length, 1);
    assert.equal(state.slices[0].stories[col.id].length, 1);
    assert.deepEqual(state.legend.map(e => e.label), ['Tasks', 'Notes', 'Questions', 'Edge cases']);
  });
});

describe('createSlice', () => {
  test('makes an empty, open slice with a card list for every step', () => {
    initState();
    state.columns.push({ id: 'second' });
    const slice = createSlice('Release 2');
    assert.equal(slice.name, 'Release 2');
    assert.equal(slice.collapsed, false);
    assert.deepEqual(Object.keys(slice.stories), [state.columns[0].id, 'second']);
    assert.ok(Object.values(slice.stories).every(cards => cards.length === 0));
  });
});

describe('undo and redo', () => {
  // Undo highlights what changed, then clears the highlight on a timer
  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout'] });
    // Empty the undo history left by earlier tests. The next pushUndo clears redo.
    while (!elements.undoBtn?.disabled) undo();
    initState();
    renders = 0;
    logged.length = 0;
  });
  afterEach(() => mock.timers.reset());

  test('undo with nothing to undo changes nothing', () => {
    state.name = 'Kept';
    undo();
    assert.equal(state.name, 'Kept');
    assert.equal(renders, 0);
  });

  test('undo restores the map from before the change and redo puts the change back', () => {
    state.name = 'Before';
    pushUndo();
    state.name = 'After';
    state.slices[0].stories[state.columns[0].id].push(createStory('Added'));

    undo();
    assert.equal(state.name, 'Before');
    assert.equal(state.slices[0].stories[state.columns[0].id].length, 1);
    assert.equal(elements.boardName.value, 'Before');

    redo();
    assert.equal(state.name, 'After');
    assert.equal(state.slices[0].stories[state.columns[0].id].length, 2);
    assert.equal(elements.boardName.value, 'After');
  });

  test('undo and redo render, save and log', () => {
    pushUndo();
    state.name = 'Changed';
    undo();
    redo();
    assert.equal(renders, 2);
    assert.deepEqual(logged, ['Undo', 'Redo']);
  });

  test('a new change clears redo', () => {
    pushUndo();
    state.name = 'First';
    undo();
    pushUndo();
    state.name = 'Second';
    redo();
    assert.equal(state.name, 'Second');
    assert.equal(elements.redoBtn.disabled, true);
  });

  test('the toolbar buttons follow what can be undone and redone', () => {
    assert.equal(elements.undoBtn.disabled, true);
    pushUndo();
    assert.equal(elements.undoBtn.disabled, false);
    assert.equal(elements.redoBtn.disabled, true);
    undo();
    assert.equal(elements.undoBtn.disabled, true);
    assert.equal(elements.redoBtn.disabled, false);
  });

  test('clearUndoHistory empties undo and redo', () => {
    pushUndo();
    pushUndo();
    undo();
    clearUndoHistory();
    state.name = 'Kept';
    undo();
    redo();
    assert.equal(state.name, 'Kept');
    assert.equal(elements.undoBtn.disabled, true);
    assert.equal(elements.redoBtn.disabled, true);
  });

  test('keeps the last 50 changes', () => {
    for (let i = 0; i < 55; i++) {
      state.name = `v${i}`;
      pushUndo();
    }
    state.name = 'v55';
    for (let i = 0; i < 60; i++) undo();
    assert.equal(state.name, 'v5');
  });
});
