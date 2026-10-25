import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseOrigins, buildAllowedOrigins } from '../server/middleware.js';

describe('parseOrigins', () => {
  test('empty input yields empty Set', () => {
    assert.deepEqual([...parseOrigins('')], []);
  });

  test('comma-separated values become a Set', () => {
    const out = parseOrigins('https://a.example,https://b.example');
    assert.ok(out.has('https://a.example'));
    assert.ok(out.has('https://b.example'));
    assert.equal(out.size, 2);
  });

  test('whitespace around entries is trimmed', () => {
    const out = parseOrigins('  https://a.example ,   https://b.example  ');
    assert.ok(out.has('https://a.example'));
    assert.ok(out.has('https://b.example'));
    assert.equal(out.size, 2);
  });

  test('empty entries between commas are filtered', () => {
    const out = parseOrigins('https://a.example,,https://b.example,');
    assert.equal(out.size, 2);
  });
});

describe('buildAllowedOrigins', () => {
  test('falls back to hardcoded storymaps.io defaults when env is empty', () => {
    const out = buildAllowedOrigins('');
    assert.ok(out.has('https://storymaps.io'));
  });

  test('env value replaces defaults entirely', () => {
    const out = buildAllowedOrigins('https://my.example');
    assert.ok(out.has('https://my.example'));
    assert.ok(!out.has('https://storymaps.io'));
    assert.equal(out.size, 1);
  });
});
