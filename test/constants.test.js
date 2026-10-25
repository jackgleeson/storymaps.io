import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  generateId, isValidUrl, normalizePoints, normalizeSliceGoal, normalizeSliceDate, copySliceDetails, escHtml,
} from '../src/core/constants.js';

describe('generateId', () => {
  test('is 8 lowercase base36 characters', () => {
    for (let i = 0; i < 200; i++) assert.match(generateId(), /^[0-9a-z]{8}$/);
  });

  test('does not repeat', () => {
    const ids = Array.from({ length: 1000 }, generateId);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe('isValidUrl', () => {
  test('allows http and https', () => {
    assert.ok(isValidUrl('https://example.com/a?b=c'));
    assert.ok(isValidUrl('http://localhost:3000'));
  });

  test('rejects other schemes, bad URLs and empty values', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com', 'example.com', '', null, undefined]) {
      assert.equal(isValidUrl(url), false, String(url));
    }
  });
});

describe('normalizePoints', () => {
  test('keeps numbers and turns numeric text into numbers', () => {
    assert.equal(normalizePoints(3), 3);
    assert.equal(normalizePoints(0), 0);
    assert.equal(normalizePoints('5'), 5);
    assert.equal(normalizePoints(' 2.5 '), 2.5);
  });

  test('anything else is no points', () => {
    for (const value of [null, undefined, '', '  ', 'lots', NaN, Infinity, true, false, [], {}]) {
      assert.equal(normalizePoints(value), null, String(value));
    }
  });
});

describe('slice details', () => {
  test('a goal is trimmed and cut to 200 characters', () => {
    assert.equal(normalizeSliceGoal('  Ship it  '), 'Ship it');
    assert.equal(normalizeSliceGoal('g'.repeat(250)).length, 200);
    assert.equal(normalizeSliceGoal(42), '');
  });

  test('a target date must be a real YYYY-MM-DD date', () => {
    assert.equal(normalizeSliceDate('2026-11-14'), '2026-11-14');
    assert.equal(normalizeSliceDate(new Date('2026-11-14T00:00:00Z')), '2026-11-14');
    for (const value of ['2026-13-01', '14/11/2026', '2026-11-14T10:00', 'soon', '', null, new Date('nope')]) {
      assert.equal(normalizeSliceDate(value), '', String(value));
    }
  });

  test('copySliceDetails copies only the details that are set', () => {
    assert.deepEqual(copySliceDetails({ goal: ' Ship ', targetDate: 'soon', name: 'MVP' }, {}), { goal: 'Ship' });
    assert.deepEqual(copySliceDetails({}, { name: 'MVP' }), { name: 'MVP' });
  });
});

describe('escHtml', () => {
  test('escapes the characters that matter in HTML text and attributes', () => {
    assert.equal(escHtml('<a href="x">Tom & Jerry</a>'), '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&lt;/a&gt;');
  });
});
