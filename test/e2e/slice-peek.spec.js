import { createHash } from 'node:crypto';
import { test, expect, openMap } from './fixtures.js';

const MAP = `name: Coffee app
steps:
  - Browse
  - Order
  - Pay
slices:
  - name: Phase 1
    collapsed: true
    closedReason: complete
    stories:
      Browse:
        - name: Drinks by category
        - name: Search by name
      Pay:
        - name: Card payment
  - name: Phase 2
    stories:
      Order:
        - name: Pick size
`;

const banner = (page) => page.locator('.slice-container').first().locator('.slice-completed-banner');
const peekToggle = (page) => banner(page).getByRole('button', { name: /Phase 1/ });
const firstSliceCards = (page) => page.locator('.slice-container').first().locator('.story-card textarea');

test('a closed slice shows its card count, and its banner shows the cards to this browser only', async ({ page, createMap, pullMap, openSecondTab }) => {
  const id = await createMap(MAP);
  await openMap(page, id);
  await expect(banner(page)).toContainText('3 cards');
  await expect(peekToggle(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(firstSliceCards(page)).toHaveCount(0);

  await peekToggle(page).click();
  await expect(page.locator('.slice-container').first()).toHaveClass(/slice-peeking/);
  await expect(peekToggle(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(firstSliceCards(page)).toHaveCount(3);

  // The slice stays closed on the server and for everyone else
  expect((await pullMap(id)).slices[0].collapsed).toBe(true);
  const other = await openSecondTab();
  await openMap(other, id);
  await expect(other.locator('.slice-container').first()).toHaveClass(/slice-collapsed/);

  await peekToggle(page).click();
  await expect(firstSliceCards(page)).toHaveCount(0);
  await expect(page.locator('.slice-container').first()).toHaveClass(/slice-collapsed/);
});

test('a peek ends on reload', async ({ page, createMap }) => {
  await openMap(page, await createMap(MAP));
  await peekToggle(page).click();
  await expect(firstSliceCards(page)).toHaveCount(3);
  await page.reload();
  await expect(page.locator('.step')).toHaveCount(3);
  await expect(firstSliceCards(page)).toHaveCount(0);
});

test('a locked map can still peek into a closed slice', async ({ page, createMap, request }) => {
  const id = await createMap(MAP);
  await request.post(`/api/lock/${id}`, { data: { passwordHash: createHash('sha256').update('elsewhere').digest('hex') } });
  await openMap(page, id);
  await expect(page.getByText('This map is read-only')).toBeVisible();
  await peekToggle(page).click();
  await expect(firstSliceCards(page)).toHaveCount(3);
});

test('the Overview shows a complete slice with its state and a faded bar', async ({ page, createMap }) => {
  await openMap(page, await createMap(MAP));
  const panel = page.locator('#legendPanel');
  if (!(await panel.isVisible())) await page.locator('#legendToggle').click();
  const row = panel.locator('.map-stats-slice').first();
  await expect(row).toHaveClass(/map-stats-slice-closed/);
  await expect(row.locator('.map-stats-slice-count')).toHaveText('✓ Complete');
  await expect(row.locator('.map-stats-bar')).toBeVisible();
  await expect(row).toHaveAttribute('title', 'Phase 1: complete, 0 of 3 tasks done');
});
