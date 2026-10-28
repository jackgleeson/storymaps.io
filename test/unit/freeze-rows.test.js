import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { FREEZE_MODES, DEFAULT_FREEZE_MODE, normalizeFreezeMode } from '../../src/core/freeze-rows.js';

test('every choice keeps the steps row, and the rows are the bottom of the stack', () => {
  const order = ['users-row', 'activities-row', 'steps-row'];
  for (const [mode, rows] of Object.entries(FREEZE_MODES)) {
    if (mode === 'off') { assert.deepEqual(rows, []); continue; }
    assert.deepEqual(rows, order.slice(order.length - rows.length), mode);
  }
});

test('an unknown or missing saved choice falls back to the default', () => {
  assert.equal(normalizeFreezeMode('activities'), 'activities');
  for (const value of [null, undefined, '', 'toString', '__proto__', 'Steps', 'true']) {
    assert.equal(normalizeFreezeMode(value), DEFAULT_FREEZE_MODE, String(value));
  }
});
