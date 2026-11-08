import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { arrivalHook } from '../../src/features/analytics.js';

test('the first hit uses the address the visitor arrived on, without a slice or card link', () => {
  const hook = arrivalHook('https://storymaps.io/abc12345#card-k3m9qz1a');
  assert.deepEqual(hook('event', { website: 'w', url: 'https://storymaps.io/other' }), { website: 'w', url: 'https://storymaps.io/abc12345' });
});

test('later hits are left as they are', () => {
  const hook = arrivalHook('https://storymaps.io/tour');
  hook('event', { url: 'https://storymaps.io/newmap12' });
  const later = { url: 'https://storymaps.io/another1', referrer: '/tour' };
  assert.equal(hook('event', later), later);
});
