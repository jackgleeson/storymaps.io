import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { sha256Hex } from '../../src/core/sha256.js';

test('gives the same hash as the standard SHA-256', () => {
  const samples = ['', 'abc', 'open sesame', 'pässwörd', '🔒 lock', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'y'.repeat(1000)];
  for (const text of samples) {
    const expected = createHash('sha256').update(text).digest('hex');
    assert.equal(sha256Hex(new TextEncoder().encode(text)), expected, `length ${text.length}`);
  }
});
