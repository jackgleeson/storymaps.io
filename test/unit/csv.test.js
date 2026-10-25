import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseCsv, escapeCSV, parseInlineNotation, formatInlineNotation, exportToCsv, importFromCsv } from '../../src/transfer/csv.js';
import { samples, cardLayout } from '../fixtures.js';

const roundTrip = (map) => importFromCsv(exportToCsv(map));

// CSV import trims every cell, so compare card names without surrounding spaces
const trimmed = (layout) => JSON.parse(JSON.stringify(layout, (key, value) => typeof value === 'string' ? value.trim() : value));

describe('parseCsv', () => {
  test('splits rows and cells', () => {
    assert.deepEqual(parseCsv('a,b\nc,d'), [['a', 'b'], ['c', 'd']]);
  });

  test('reads quoted cells with commas, quotes and line breaks', () => {
    assert.deepEqual(parseCsv('"a,b","say ""hi""","two\nlines"'), [['a,b', 'say "hi"', 'two\nlines']]);
  });

  test('handles Windows line endings', () => {
    assert.deepEqual(parseCsv('a,b\r\nc,d'), [['a', 'b'], ['c', 'd']]);
  });

  test('strips a byte order mark', () => {
    assert.deepEqual(parseCsv('﻿name,x'), [['name', 'x']]);
  });

  test('keeps empty cells between commas', () => {
    assert.deepEqual(parseCsv('a,,c'), [['a', '', 'c']]);
  });

  test('keeps an empty last cell after a trailing comma', () => {
    assert.deepEqual(parseCsv('a,\nb,'), [['a', ''], ['b', '']]);
    assert.deepEqual(parseCsv('"a",\r\nb'), [['a', ''], ['b']]);
  });

  test('a trailing line break adds no row', () => {
    assert.deepEqual(parseCsv('a\n'), [['a']]);
    assert.deepEqual(parseCsv('a\r\n'), [['a']]);
  });

  test('empty input has no rows', () => {
    assert.deepEqual(parseCsv(''), []);
  });

  test('reads back what escapeCSV writes', () => {
    const values = ['plain', 'a,b', 'say "hi"', 'two\nlines', '', 'carriage\rreturn'];
    assert.deepEqual(parseCsv(values.map(escapeCSV).join(',')), [values]);
  });
});

describe('inline card notation', () => {
  test('a plain name has no extra fields', () => {
    assert.deepEqual(parseInlineNotation('Sign up'), { name: 'Sign up' });
    assert.deepEqual(parseInlineNotation(''), { name: '' });
  });

  test('reads every field', () => {
    assert.deepEqual(
      parseInlineNotation('Pay [status:done, points:2.5, tags:a;b, color:#fecdd3, url:https://example.com/pay, body:Card, cash, or vouchers]'),
      { name: 'Pay', status: 'done', points: 2.5, tags: ['a', 'b'], color: '#fecdd3', url: 'https://example.com/pay', body: 'Card, cash, or vouchers' },
    );
  });

  test('drops an unknown status, a bad colour and points that are not a number', () => {
    assert.deepEqual(parseInlineNotation('Pay [status:someday, color:red, points:many]'), { name: 'Pay' });
  });

  test('reads back what formatInlineNotation writes', () => {
    const card = { name: 'Pay', status: 'blocked', points: 0, tags: ['x', 'y'], color: '#a5f3fc', url: 'https://example.com', body: 'Line one\nline two, with commas' };
    assert.deepEqual(parseInlineNotation(formatInlineNotation(card)), card);
  });

  test('a card name ending in brackets keeps its brackets', () => {
    assert.deepEqual(parseInlineNotation(formatInlineNotation({ name: 'Support [beta]' })), { name: 'Support [beta]' });
  });

  test('a body with brackets in it survives', () => {
    const card = { name: 'Docs', status: 'done', body: 'See [the guide] first' };
    assert.deepEqual(parseInlineNotation(formatInlineNotation(card)), card);
  });
});

describe('CSV round trip', () => {
  const csvMap = () => ({
    name: 'Coffee app',
    steps: [
      { name: 'Browse', color: '#fecdd3', status: 'done', points: 3, tags: ['ux', 'web'], url: 'https://example.com/browse' },
      { name: '', hidden: true },
      { name: 'Order' },
    ],
    users: [[{ name: 'Customer', color: '#fca5a5' }], [], []],
    activities: [[{ name: 'Find a drink', status: 'planned' }], [], [{ name: 'Pay', url: 'https://example.com/pay' }]],
    slices: [{
      name: 'MVP',
      stories: [
        [{ name: 'List drinks', status: 'in-progress', points: 0, color: '#a5f3fc', tags: ['menu'], url: 'https://example.com/list', body: 'Hot, cold, and "iced"' }],
        [{ name: 'Under the hidden step' }],
        [{ name: 'Card payment' }, { name: 'Cash' }],
      ],
    }],
    legend: [{ color: '#fef08a', label: 'Tasks, mostly' }],
    notes: 'Line one\nLine two',
  });

  test('keeps the name, steps and their details', () => {
    const out = roundTrip(csvMap());
    assert.equal(out.name, 'Coffee app');
    assert.deepEqual(out.steps[0], { name: 'Browse', color: '#fecdd3', status: 'done', points: 3, tags: ['ux', 'web'], url: 'https://example.com/browse' });
    assert.equal(out.steps[1].hidden, true);
    assert.equal(out.steps[2].name, 'Order');
  });

  test('keeps every card and its details where it was', () => {
    const out = roundTrip(csvMap());
    assert.deepEqual(out.users, csvMap().users);
    assert.deepEqual(out.activities, csvMap().activities);
    assert.deepEqual(out.slices[0].stories, csvMap().slices[0].stories);
  });

  test('keeps the legend and notes', () => {
    const out = roundTrip(csvMap());
    assert.deepEqual(out.legend, csvMap().legend);
    assert.equal(out.notes, 'Line one\nLine two');
  });

  for (const { file, data } of samples()) {
    test(`the ${file} sample keeps every step and card in place`, () => {
      assert.deepEqual(cardLayout(roundTrip(data)), trimmed(cardLayout(data)));
    });
  }

  test('a legend longer than the steps row adds no steps', () => {
    const legend = ['Tasks', 'Notes', 'Questions', 'Edge cases'].map(label => ({ color: '#fef08a', label }));
    const out = roundTrip({ name: 'x', steps: [{ name: 'Only' }], slices: [{ name: 'MVP', stories: [[{ name: 'Card' }]] }], legend });
    assert.deepEqual(out.steps.map(s => s.name), ['Only']);
    assert.equal(out.legend.length, 4);
  });

  test('a trailing hidden step with cards is kept', () => {
    const out = roundTrip({ name: 'x', steps: [{ name: 'A' }, { name: '', hidden: true }], slices: [{ name: 'MVP', stories: [[], [{ name: 'Under it' }]] }] });
    assert.equal(out.steps.length, 2);
    assert.deepEqual(out.slices[0].stories[1], [{ name: 'Under it' }]);
  });

  test('a step body survives', () => {
    const out = roundTrip({ name: 'x', steps: [{ name: 'Browse', body: 'The menu' }], slices: [] });
    assert.equal(out.steps[0].body, 'The menu');
  });

  test('two slices with the same name stay separate', () => {
    const out = roundTrip({
      name: 'x',
      steps: [{ name: 'A' }],
      slices: [{ name: '', stories: [[{ name: 'First' }]] }, { name: '', stories: [[{ name: 'Second' }]] }],
    });
    assert.deepEqual(out.slices.map(s => s.stories[0].map(c => c.name)), [['First'], ['Second']]);
  });

  test('slice details stay with the right one of two slices with the same name', () => {
    const out = roundTrip({
      name: 'x',
      steps: [{ name: 'A' }],
      slices: [{ name: 'Sprint', stories: [[{ name: 'First' }]] }, { name: 'Sprint', stories: [[{ name: 'Second' }]], goal: 'Ship it', collapsed: true }],
    });
    assert.equal(out.slices.length, 2);
    assert.equal(out.slices[0].goal, undefined);
    assert.equal(out.slices[0].collapsed, undefined);
    assert.equal(out.slices[1].goal, 'Ship it');
    assert.equal(out.slices[1].collapsed, true);
  });

  test('slices with the same name that are not next to each other stay separate', () => {
    const out = roundTrip({
      name: 'x',
      steps: [{ name: 'A' }],
      slices: [{ name: 'MVP', stories: [[{ name: 'One' }]] }, { name: 'Later', stories: [[{ name: 'Two' }]] }, { name: 'MVP', stories: [[{ name: 'Three' }]] }],
    });
    assert.deepEqual(out.slices.map(s => [s.name, s.stories[0].map(c => c.name)]), [['MVP', ['One']], ['Later', ['Two']], ['MVP', ['Three']]]);
  });

  test('several rows of one slice are read as one slice', () => {
    const out = importFromCsv('steps,A,B\nslice:MVP,story:One,story:Two\nslice:MVP,story:Three,\n');
    assert.equal(out.slices.length, 1);
    assert.deepEqual(out.slices[0].stories.map(c => c.map(s => s.name)), [['One', 'Three'], ['Two']]);
  });

  test('partial maps and the steps that use them survive', () => {
    const out = roundTrip({
      name: 'x',
      steps: [{ name: 'Browse' }, { partialMapId: 'pm000001', partialMapOrigin: true }],
      slices: [{ name: 'MVP', stories: [[{ name: 'List' }], []] }],
      partialMaps: [{ id: 'pm000001', name: 'Checkout', users: [[], []], activities: [[], []], steps: [{ name: 'Pay' }, { name: 'Receipt' }], stories: [[[{ name: 'Apple Pay' }], [{ name: 'Email it' }]]] }],
    });
    const [pm] = out.partialMaps;
    assert.equal(pm.name, 'Checkout');
    assert.deepEqual(pm.steps.map(s => s.name), ['Pay', 'Receipt']);
    assert.deepEqual(pm.stories, [[[{ name: 'Apple Pay' }], [{ name: 'Email it' }]]]);
    assert.deepEqual(out.steps[1], { partialMapId: pm.id, partialMapOrigin: true });
  });
});

describe('importFromCsv', () => {
  test('skips comment and blank rows', () => {
    const out = importFromCsv('# A comment\n\nname,Mine\n# Another\nsteps,A\n');
    assert.equal(out.name, 'Mine');
    assert.deepEqual(out.steps.map(s => s.name), ['A']);
  });

  test('an empty file is rejected', () => {
    assert.throws(() => importFromCsv(''), /Empty CSV/);
  });

  test('a file without a steps row is rejected', () => {
    assert.throws(() => importFromCsv('name,Mine\n'), /Missing "steps" row/);
  });
});
