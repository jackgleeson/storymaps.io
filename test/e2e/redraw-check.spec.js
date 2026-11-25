import { test, expect, openMap } from './fixtures.js';

// The fixtures fail a test when a redraw leaves the page different from the map built from nothing.
// These tests check the comparison itself: what it reports and what it lets pass.
const compare = (page, change) => page.evaluate(async (change) => {
  const { compareMaps } = await import('/src/ui/redraw-check.js');
  const map = document.getElementById('storyMap');
  const copy = map.cloneNode(true);
  // A copy of a textarea has the text it was built with, so give each one what the page shows
  const shown = [...map.querySelectorAll('textarea')].map(t => t.value);
  copy.querySelectorAll('textarea').forEach((t, i) => { t.value = shown[i]; });
  const card = copy.querySelector('.slice-container .story-card');
  if (change === 'title') card.querySelector('textarea').value = 'Old title';
  if (change === 'colour') card.style.backgroundColor = 'rgb(1, 2, 3)';
  if (change === 'missing') card.remove();
  if (change === 'new class') card.classList.add('some-new-mark');
  if (change === 'hover') card.classList.add('card-hovered', 'sortable-chosen');
  if (change === 'selected') card.classList.add('card-selected');
  return compareMaps(map, copy);
}, change);

test('the redraw check passes a map that matches, and marks left by the pointer or a selection', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  expect(await compare(page, 'nothing')).toBeNull();
  expect(await compare(page, 'hover')).toBeNull();
  expect(await compare(page, 'selected')).toBeNull();
});

test('the redraw check reports a different title, colour, card or an unknown class', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  expect(await compare(page, 'title')).toContain('value="Old title"');
  expect(await compare(page, 'colour')).toContain('rgb(1, 2, 3)');
  expect(await compare(page, 'missing')).toContain('differ at line');
  expect(await compare(page, 'new class')).toContain('some-new-mark');
});
