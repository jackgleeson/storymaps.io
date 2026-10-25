import { test } from 'node:test';
import { strict as assert } from 'node:assert';

test('test harness is wired up', () => {
  assert.equal(1 + 1, 2);
});

test('client modules with site-root imports load in Node', async () => {
  const { createSlice } = await import('/src/core/state.js');
  assert.equal(typeof createSlice, 'function');
});
