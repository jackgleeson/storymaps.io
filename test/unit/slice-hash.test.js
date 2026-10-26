import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { sliceSlug, sliceHash, sliceFromHash } from '../../src/core/slice-hash.js';

test('the name part is lower case, hyphenated and at most 20 characters, cut at a whole word', () => {
  assert.equal(sliceSlug('MVP'), 'mvp');
  assert.equal(sliceSlug('Release 2.1'), 'release-2-1');
  assert.equal(sliceSlug('  Café crème / v2! '), 'cafe-creme-v2');
  assert.equal(sliceSlug('Onboarding improvements for new users'), 'onboarding');
  assert.equal(sliceSlug('Payments and refunds for EU customers'), 'payments-and-refunds');
  assert.equal(sliceSlug('Supercalifragilisticexpialidocious release'), 'supercalifragilistic');
  assert.ok(sliceSlug('Onboarding improvements for new users').length <= 20);
});

test('a slice with nothing readable in its name links by ID alone', () => {
  assert.equal(sliceSlug(''), '');
  assert.equal(sliceSlug(undefined), '');
  assert.equal(sliceSlug('リリース'), '');
  assert.equal(sliceHash({ id: 'xr47fle3', name: '' }), '#slice-xr47fle3');
  assert.equal(sliceHash({ id: 'xr47fle3', name: 'MVP' }), '#slice-mvp-xr47fle3');
});

test('a link finds the slice by the ID at the end, whatever the name part says', () => {
  const slices = [{ id: 'xr47fle3', name: 'Launch' }, { id: 'ab12cd34', name: 'MVP' }];
  assert.equal(sliceFromHash('#slice-mvp-xr47fle3', slices).id, 'xr47fle3');
  assert.equal(sliceFromHash('#slice-launch-xr47fle3', slices).id, 'xr47fle3');
  assert.equal(sliceFromHash('#slice-mvp-ab12cd34', slices).id, 'ab12cd34');
});

test('links made before the name part still open', () => {
  const slices = [{ id: 'xr47fle3', name: 'MVP' }];
  assert.equal(sliceFromHash('#slice-xr47fle3', slices).id, 'xr47fle3');
});

test('imported IDs with hyphens match whole, the longest first', () => {
  const slices = [{ id: 'mvp', name: 'A' }, { id: 'release-mvp', name: 'B' }];
  assert.equal(sliceFromHash('#slice-release-mvp', slices).id, 'release-mvp');
  assert.equal(sliceFromHash('#slice-b-release-mvp', slices).id, 'release-mvp');
  assert.equal(sliceFromHash('#slice-a-mvp', slices).id, 'mvp');
});

test('other hashes are not slice links, and a missing slice is null', () => {
  const slices = [{ id: 'xr47fle3', name: 'MVP' }];
  assert.equal(sliceFromHash('', slices), undefined);
  assert.equal(sliceFromHash('#notes', slices), undefined);
  assert.equal(sliceFromHash('#slice-mvp-zzzzzzzz', slices), null);
  assert.equal(sliceFromHash('#slice-', slices), undefined);
});
