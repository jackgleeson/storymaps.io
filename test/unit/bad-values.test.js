import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { findBadValues, badValuesLine } from '../../server/bad-values.js';

// The shape serializeDoc gives: cards in columns, one list for each step
const map = (changes = {}) => ({
  name: 'Coffee app',
  steps: [{ name: 'Browse', color: '#bbf7d0' }, { name: 'Pay' }],
  users: [[{ name: 'Customer', color: '#fca5a5' }], []],
  activities: [[], []],
  slices: [{ name: 'MVP', stories: [[{ name: 'Menu', color: '#fef08a' }], [{ name: 'Card' }]] }],
  legend: [{ color: '#fef08a', label: 'Tasks' }],
  ...changes,
});

describe('findBadValues', () => {
  test('a sound map has none', () => {
    assert.deepEqual(findBadValues(map()), []);
    assert.equal(badValuesLine('abc12345', map()), null);
  });

  test('a mistyped status or colour name is not one, since the map still opens', () => {
    assert.deepEqual(findBadValues(map({ slices: [{ name: 'MVP', stories: [[{ name: 'Menu', status: 'donee', color: 'purplee', points: 'lots' }], []] }] })), []);
  });

  test('finds a colour that is not text, wherever it is', () => {
    assert.deepEqual(findBadValues(map({
      steps: [{ name: 'Browse', color: 5 }, { name: 'Pay' }],
      users: [[{ name: 'Customer', color: { a: 1 } }], []],
      slices: [{ name: 'MVP', stories: [[], [{ name: 'Card', color: true }]] }],
      legend: [{ color: ['red'], label: 'Tasks' }],
    })), ['steps[0].color', 'users[0][0].color', 'slices[0].stories[1][0].color', 'legend[0].color']);
  });

  test('finds a slice name or legend label that is not text, and a name that is a set of fields', () => {
    assert.deepEqual(findBadValues(map({
      name: { a: 1 },
      steps: [{ name: { a: 1 } }, { name: 'Pay' }],
      slices: [{ name: 2026, stories: [[], []] }],
      legend: [{ color: '#fef08a', label: 5 }],
    })), ['name', 'steps[0].name', 'slices[0].name', 'legend[0].label']);
  });

  test('looks inside partials', () => {
    const partialMaps = [{ id: 'p1', name: 'Pay', steps: [{ name: 'Pay', color: 5 }], users: [[]], activities: [[]], stories: [[[{ name: 'Card', color: 7 }]]] }];
    assert.deepEqual(findBadValues(map({ partialMaps })), ['partialMaps[0].steps[0].color', 'partialMaps[0].stories[0][0][0].color']);
  });
});

describe('badValuesLine', () => {
  test('names the map and the fields, and never the values', () => {
    const line = badValuesLine('abc12345', map({ slices: [{ name: 2026, stories: [[{ name: 'Secret plan', color: 31337 }], []] }] }));
    assert.match(line, /\[bad-values\] abc12345: 2 not text: slices\[0\]\.name, slices\[0\]\.stories\[0\]\[0\]\.color$/);
    assert.doesNotMatch(line, /2026-?$|31337|Secret plan/);
  });

  test('lists ten fields at most', () => {
    const cards = Array.from({ length: 14 }, () => ({ name: 'x', color: 1 }));
    const line = badValuesLine('abc12345', map({ slices: [{ name: 'MVP', stories: [cards, []] }] }));
    assert.match(line, /14 not text: .*stories\[0\]\[9\]\.color, and 4 more$/);
  });
});
