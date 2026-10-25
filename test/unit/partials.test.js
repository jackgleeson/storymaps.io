import { describe, test, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

// Partial map operations change the map state, then scroll to the result. Stub the page.
const fakeElement = () => ({ value: '', querySelector: () => null, querySelectorAll: () => [] });
globalThis.document ??= { getElementById: () => fakeElement() };
globalThis.window ??= { location: { hostname: 'storymaps.io' } };
globalThis.location ??= { hostname: 'storymaps.io' };
globalThis.requestAnimationFrame ??= () => 0;

const { state, partialMapEditState, clearSelection, undo, clearUndoHistory, init: initState } = await import('/src/core/state.js');
const { serialize, deserialize } = await import('/src/core/serialization.js');
const partials = await import('/src/features/partials.js');

let renders = 0;
const panelTabs = [];
partials.init({ renderAndSave: () => { renders++; }, switchPanelTab: (tab) => panelTabs.push(tab) });
initState({ serialize, deserialize, renderAndSave: () => { renders++; }, logEvent: () => {} });

const map = () => ({
  app: 'storymap', v: 1, name: 'Shop',
  steps: [{ name: 'Browse' }, { name: 'Sign in' }, { name: 'Verify' }, { name: 'Pay' }],
  users: [[{ name: 'Guest' }], [], [], []],
  activities: [[{ name: 'Find' }], [{ name: 'Log in' }], [], [{ name: 'Checkout' }]],
  slices: [
    { name: 'MVP', stories: [[{ name: 'List' }], [{ name: 'Email' }], [{ name: 'Code' }], [{ name: 'Card' }]] },
    { name: 'Later', stories: [[], [{ name: 'Google' }], [], []] },
  ],
});

// Everything the map would export, minus the header
const exported = () => {
  const { app, v, exported: _e, site, id, ...rest } = serialize();
  return rest;
};
const stepNames = () => state.columns.map(c => c.partialMapId ? `[${state.partialMaps.find(p => p.id === c.partialMapId)?.name}]` : c.name);
const colByName = (name) => state.columns.find(c => c.name === name);

beforeEach(() => {
  deserialize(map());
  clearSelection();
  clearUndoHistory();
  partialMapEditState.activeId = null;
  partialMapEditState.editingColIds = new Set();
  renders = 0;
  panelTabs.length = 0;
});

describe('creating a partial map', () => {
  test('moves the selected steps and their cards into the partial, leaving a reference', () => {
    partials.createPartialMap('Login', [colByName('Sign in').id, colByName('Verify').id]);
    assert.deepEqual(stepNames(), ['Browse', '[Login]', 'Pay']);
    const [pm] = state.partialMaps;
    assert.deepEqual(pm.columns.map(c => c.name), ['Sign in', 'Verify']);
    assert.deepEqual(pm.activities[pm.columns[0].id].map(c => c.name), ['Log in']);
    assert.deepEqual(pm.stories[state.slices[1].id][pm.columns[0].id].map(c => c.name), ['Google']);
    const ref = state.columns[1];
    assert.equal(ref.partialMapOrigin, true);
    assert.ok(state.slices.every(s => Array.isArray(s.stories[ref.id])));
    assert.deepEqual(panelTabs, ['partials']);
  });

  test('the result survives a save and load', () => {
    partials.createPartialMap('Login', [colByName('Sign in').id, colByName('Verify').id]);
    const saved = exported();
    deserialize({ app: 'storymap', v: 1, ...saved });
    assert.deepEqual(exported(), saved);
  });

  test('an empty selection changes nothing, and adds nothing to undo', () => {
    state.name = 'Before';
    partials.createPartialMap('Nothing', []);
    state.name = 'After';
    undo();
    assert.equal(state.name, 'After');
    assert.equal(state.partialMaps.length, 0);
  });
});

describe('editing a partial map', () => {
  const makePartial = () => {
    partials.createPartialMap('Login', [colByName('Sign in').id, colByName('Verify').id]);
    return state.partialMaps[0];
  };

  test('opening it puts its steps back on the map after the reference, plus a blank step', () => {
    const pm = makePartial();
    partials.startEditingPartial(pm.id);
    assert.deepEqual(state.columns.map(c => c.name), ['Browse', '', 'Sign in', 'Verify', '', 'Pay']);
    assert.equal(state.columns[1]._editingHidden, true);
    assert.equal(state.columns[4]._partialBlank, true);
    assert.equal(partialMapEditState.activeId, pm.id);
  });

  test('opening and closing it without changes leaves the map as it was', () => {
    makePartial();
    const before = exported();
    partials.startEditingPartial(state.partialMaps[0].id);
    partials.stopEditingPartial();
    assert.deepEqual(exported(), before);
    assert.equal(partialMapEditState.activeId, null);
  });

  test('cards added while editing are saved into the partial', () => {
    const pm = makePartial();
    partials.startEditingPartial(pm.id);
    state.slices[0].stories[colByName('Verify').id].push({ id: 'newcard1', name: 'SMS', tags: [] });
    partials.stopEditingPartial();
    assert.deepEqual(stepNames(), ['Browse', '[Login]', 'Pay']);
    const verify = state.partialMaps[0].columns[1];
    assert.deepEqual(state.partialMaps[0].stories[state.slices[0].id][verify.id].map(c => c.name), ['Code', 'SMS']);
  });

  test('a step added in the blank column is kept; an untouched blank column is dropped', () => {
    const pm = makePartial();
    partials.startEditingPartial(pm.id);
    state.columns[4].name = 'Remember me';
    partials.ensurePartialBlankCol();
    partials.stopEditingPartial();
    assert.deepEqual(state.partialMaps[0].columns.map(c => c.name), ['Sign in', 'Verify', 'Remember me']);
    assert.ok(state.partialMaps[0].columns.every(c => !('_partialBlank' in c)));
  });
});

describe('removing a partial map', () => {
  test('deletePartialMap removes the partial and every reference to it', () => {
    partials.createPartialMap('Login', [colByName('Sign in').id]);
    const pmId = state.partialMaps[0].id;
    partials.insertPartialMapRef(pmId, 2);
    assert.equal(state.columns.filter(c => c.partialMapId === pmId).length, 2);
    partials.deletePartialMap(pmId);
    assert.deepEqual(stepNames(), ['Browse', 'Verify', 'Pay']);
    assert.equal(state.partialMaps.length, 0);
    const colIds = new Set(state.columns.map(c => c.id));
    assert.ok(Object.keys(state.users).every(id => colIds.has(id)));
    assert.ok(state.slices.every(s => Object.keys(s.stories).every(id => colIds.has(id))));
  });

  test('restorePartialMap puts the steps and cards back where the partial was', () => {
    const before = exported();
    partials.createPartialMap('Login', [colByName('Sign in').id, colByName('Verify').id]);
    partials.restorePartialMap(state.partialMaps[0].id);
    assert.deepEqual(exported(), before);
  });

  test('restorePartialMap removes every reference', () => {
    partials.createPartialMap('Login', [colByName('Sign in').id]);
    const pmId = state.partialMaps[0].id;
    partials.insertPartialMapRef(pmId, 2);
    partials.restorePartialMap(pmId);
    assert.deepEqual(stepNames(), ['Browse', 'Sign in', 'Verify', 'Pay']);
  });
});

describe('using a partial map elsewhere', () => {
  test('insertPartialMapRef adds a reference after the given step', () => {
    partials.createPartialMap('Login', [colByName('Sign in').id]);
    const pmId = state.partialMaps[0].id;
    partials.insertPartialMapRef(pmId, 2);
    assert.deepEqual(stepNames(), ['Browse', '[Login]', 'Verify', '[Login]', 'Pay']);
    assert.equal(state.columns[3].partialMapOrigin, false);
  });

  test('replaceWithPartial swaps the selected steps for a reference', () => {
    partials.createPartialMap('Login', [colByName('Sign in').id]);
    const pmId = state.partialMaps[0].id;
    const payId = colByName('Pay').id;
    partials.replaceWithPartial(pmId, [payId]);
    assert.deepEqual(stepNames(), ['Browse', '[Login]', 'Verify', '[Login]']);
    assert.equal(state.activities[payId], undefined);
    assert.ok(state.slices.every(s => !(payId in s.stories)));
  });

  test('materializePhantomColumn adds hidden spacers up to the clicked position', () => {
    const col = partials.materializePhantomColumn(2);
    assert.equal(state.columns.length, 7);
    assert.deepEqual(state.columns.slice(4).map(c => c.hidden), [true, true, false]);
    assert.equal(col, state.columns[6]);
  });
});
