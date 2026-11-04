import { test, expect, openMap } from './fixtures.js';

// Phase 1 has one card done, one in progress and one blocked; Phase 2 is open after it
const MAP = `name: Coffee app
steps:
  - Browse
  - Order
slices:
  - name: Phase 1
    stories:
      Browse:
        - name: Drinks by category
          status: done
        - name: Search by name
          status: in-progress
      Order:
        - name: Pick size
          status: blocked
  - name: Phase 2
    stories:
      Browse:
        - name: Favourites
`;

const slice = (page, i) => page.locator('.slice-container').nth(i);
const markComplete = async (page, i = 0) => {
  await slice(page, i).locator('.btn-slice-menu').click();
  await page.getByRole('button', { name: 'Mark Complete' }).click();
};
const cardNames = (page, i) => slice(page, i).locator('.story-card textarea').evaluateAll(els => els.map(e => e.value));

test('marking a slice complete offers to move the cards that are not done to the next slice', async ({ page, createMap, pullMap }) => {
  const id = await createMap(MAP);
  await openMap(page, id, 2);
  await markComplete(page);
  await expect(page.locator('.dialog-message')).toHaveText(
    '2 cards in "Phase 1" aren\'t done. Move them to the top of "Phase 2", then mark "Phase 1" complete?');
  await page.getByRole('button', { name: 'Move and complete' }).click();

  await expect(slice(page, 0)).toHaveClass(/slice-collapsed/);
  await expect(slice(page, 0).locator('.slice-card-count')).toHaveText('1 card');
  // The moved cards go to the top of the same steps, in order
  await expect.poll(() => cardNames(page, 1)).toEqual(['Search by name', 'Favourites', 'Pick size']);
  await expect.poll(async () => {
    const map = await pullMap(id);
    return [map.slices[0].stories[0].length, map.slices[1].stories[0][0]?.name];
  }).toEqual([1, 'Search by name']);

  // One undo puts everything back
  await page.locator('#undoBtn').click();
  await expect(slice(page, 0)).not.toHaveClass(/slice-collapsed/);
  await expect.poll(() => cardNames(page, 0)).toEqual(['Drinks by category', 'Search by name', 'Pick size']);
});

test('completing anyway shows how many cards are done on the banner and in the Overview', async ({ page, createMap }) => {
  await openMap(page, await createMap(MAP), 2);
  await markComplete(page);
  await page.getByRole('button', { name: 'Complete anyway' }).click();
  await expect(slice(page, 0).locator('.slice-card-count')).toHaveText('3 cards');
  await expect(slice(page, 0).locator('.slice-not-done')).toHaveText('2 not done');

  const panel = page.locator('#legendPanel');
  if (!(await panel.isVisible())) await page.locator('#legendToggle').click();
  const count = panel.locator('.map-stats-slice').first().locator('.map-stats-slice-count');
  await expect(count).toHaveClass(/map-stats-complete/);
  await expect(count).toHaveText('✓ Complete2 not done');
});

test('cancelling leaves the slice open', async ({ page, createMap }) => {
  await openMap(page, await createMap(MAP), 2);
  await markComplete(page);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(slice(page, 0)).not.toHaveClass(/slice-collapsed/);
  await expect(slice(page, 0).locator('.story-card')).toHaveCount(3);
});

test('with no open slice after it, the cards move to a new slice', async ({ page, createMap }) => {
  // Phase 2 is already complete, so it can't take the cards
  await openMap(page, await createMap(MAP.replace('  - name: Phase 2\n', '  - name: Phase 2\n    collapsed: true\n    closedReason: complete\n')), 2);
  await markComplete(page);
  await expect(page.locator('.dialog-message')).toContainText('Move them to a new slice after it');
  await page.getByRole('button', { name: 'Move and complete' }).click();
  await expect(page.locator('.slice-container')).toHaveCount(3);
  await expect(slice(page, 1).locator('.slice-label')).toHaveText('Carried over from Phase 1');
  await expect.poll(() => cardNames(page, 1)).toEqual(['Search by name', 'Pick size']);
});

test('a slice with no statuses is marked complete without asking', async ({ page, createMap }) => {
  await openMap(page, await createMap(MAP.replace(/\n {10}status: [a-z-]+/g, '')), 2);
  await markComplete(page);
  await expect(slice(page, 0)).toHaveClass(/slice-collapsed/);
  await expect(page.locator('.dialog-overlay.visible')).toHaveCount(0);
  await expect(slice(page, 0).locator('.slice-card-count')).toHaveText('3 cards');
});

test('Close folds a slice with a Closed banner', async ({ page, createMap }) => {
  await openMap(page, await createMap(MAP), 2);
  await slice(page, 0).locator('.btn-slice-menu').click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(slice(page, 0).locator('.slice-closed-banner')).toContainText('Closed');
  await expect(slice(page, 0).locator('.slice-card-count')).toHaveText('3 cards');
});
