import { describe, test, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

// Search dims the cards on the page that don't match. Stand in for the page with fake step and
// card elements that carry the same data attributes and text as the real ones.
const fakeClassList = () => {
  const classes = new Set();
  return { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) };
};
let pageElements = [];
const storyMap = {
  querySelectorAll: (selector) => {
    if (selector === '.step') return pageElements.filter(e => e.kind === 'step');
    if (selector === '.story-card') return pageElements.filter(e => e.kind === 'card');
    if (selector === '.search-dimmed') return pageElements.filter(e => e.classList.contains('search-dimmed'));
    return [];
  },
};
globalThis.document ??= { getElementById: (id) => (id === 'storyMap' ? storyMap : null) };
globalThis.window ??= { location: { hostname: 'storymaps.io' } };
globalThis.location ??= { hostname: 'storymaps.io' };
window.matchMedia ??= () => ({ matches: false, addEventListener() {} });
const memoryStorage = () => {
  const items = new Map();
  return { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => items.set(k, String(v)), removeItem: (k) => items.delete(k) };
};
globalThis.localStorage ??= memoryStorage();
globalThis.sessionStorage ??= memoryStorage();

const { state } = await import('/src/core/state.js');
const { deserialize } = await import('/src/core/serialization.js');
const search = await import('/src/features/search.js');

const stepEl = (column) => ({
  kind: 'step',
  dataset: { columnId: column.id },
  classList: fakeClassList(),
  querySelector: (sel) => (sel === '.step-text' ? { value: column.name } : null),
});
const cardEl = (card, { columnId, sliceId, rowType, preview = false }) => ({
  kind: 'card',
  dataset: { storyId: card.id, columnId, sliceId, rowType },
  classList: fakeClassList(),
  querySelector: (sel) => {
    if (sel === '.story-text' && !preview) return { value: card.name };
    if (sel === '.story-text-preview' && preview) return { textContent: card.name };
    return null;
  },
});

beforeEach(() => {
  deserialize({
    app: 'storymap', v: 1, name: 'Shop',
    steps: [{ name: 'Browse products' }, { name: 'Pay' }, { partialMapId: 'pm000001' }],
    users: [[{ name: 'Guest shopper' }], [], []],
    activities: [[], [{ name: 'Checkout' }], []],
    slices: [{ name: 'MVP', stories: [[{ name: 'Product list' }], [{ name: 'Card payment' }], []] }],
    partialMaps: [{ id: 'pm000001', name: 'Login', users: [[{ name: 'Member' }]], activities: [[]], steps: [{ name: 'Sign in' }], stories: [[[{ name: 'Email login' }]]] }],
  });
  const [browse, pay] = state.columns;
  const slice = state.slices[0];
  pageElements = [
    stepEl(browse),
    stepEl(pay),
    cardEl(state.users[browse.id][0], { columnId: browse.id, rowType: 'users' }),
    cardEl(state.activities[pay.id][0], { columnId: pay.id, rowType: 'activities' }),
    cardEl(slice.stories[browse.id][0], { columnId: browse.id, sliceId: slice.id }),
    cardEl(slice.stories[pay.id][0], { columnId: pay.id, sliceId: slice.id, preview: true }),
  ];
});

const visible = () => pageElements
  .filter(e => !e.classList.contains('search-dimmed'))
  .map(e => (e.kind === 'step' ? e.querySelector('.step-text').value : (e.querySelector('.story-text')?.value ?? e.querySelector('.story-text-preview').textContent)));

describe('text search', () => {
  test('dims the steps and cards that do not contain the text, ignoring case', () => {
    search.applySearchFilter('PRODUCT');
    assert.deepEqual(visible(), ['Browse products', 'Product list']);
  });

  test('matches cards shown as a preview too', () => {
    search.applySearchFilter('payment');
    assert.deepEqual(visible(), ['Card payment']);
  });

  test('an empty search shows everything again', () => {
    search.applySearchFilter('product');
    search.applySearchFilter('');
    assert.equal(visible().length, pageElements.length);
  });

  test('a search that matches nothing dims everything', () => {
    search.applySearchFilter('zebra');
    assert.deepEqual(visible(), []);
  });
});

describe('finding the card behind an element', () => {
  test('finds steps, including the steps of a partial map', () => {
    assert.equal(search.getItemForStep({ dataset: { columnId: state.columns[1].id } }).name, 'Pay');
    const signIn = state.partialMaps[0].columns[0];
    assert.equal(search.getItemForStep({ dataset: { columnId: signIn.id } }).name, 'Sign in');
    assert.equal(search.getItemForStep({ dataset: { columnId: 'nothere1' } }), undefined);
  });

  test('finds user, activity and story cards', () => {
    for (const el of pageElements.filter(e => e.kind === 'card')) {
      assert.equal(search.getItemForStoryCard(el)?.id, el.dataset.storyId);
    }
  });

  test('finds the cards of a partial map', () => {
    const pm = state.partialMaps[0];
    const colId = pm.columns[0].id;
    const member = pm.users[colId][0];
    const email = pm.stories[state.slices[0].id][colId][0];
    assert.equal(search.getItemForStoryCard({ dataset: { storyId: member.id, columnId: colId, rowType: 'users' } }), member);
    assert.equal(search.getItemForStoryCard({ dataset: { storyId: email.id, columnId: colId, sliceId: state.slices[0].id } }), email);
  });

  test('returns nothing for an unknown card', () => {
    assert.equal(search.getItemForStoryCard({ dataset: { storyId: 'nothere1', columnId: state.columns[0].id, sliceId: state.slices[0].id } }), undefined);
  });
});

describe('filters', () => {
  test('no filters are on to start with, and every card passes', () => {
    assert.equal(search.hasActiveFilters(), false);
    assert.equal(search.itemMatchesFilters(state.columns[0]), true);
  });

  test('a card that cannot be found never matches', () => {
    assert.equal(search.itemMatchesFilters(undefined), false);
  });
});
