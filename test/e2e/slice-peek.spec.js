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
const firstSlice = (page) => page.locator('.slice-container').first();
const firstSliceCards = (page) => firstSlice(page).locator('.story-card');

test('a closed slice shows its card count, and its banner shows the cards to this browser only', async ({ page, createMap, pullMap, openSecondTab }) => {
  const id = await createMap(MAP);
  await openMap(page, id);
  await expect(banner(page)).toContainText('3 cards');
  await expect(peekToggle(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(peekToggle(page)).toContainText('Show cards');
  await expect(firstSliceCards(page)).toHaveCount(0);

  await peekToggle(page).click();
  await expect(page.locator('.slice-container').first()).toHaveClass(/slice-peeking/);
  await expect(peekToggle(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(peekToggle(page)).toContainText('Hide cards');
  await expect(firstSliceCards(page)).toHaveCount(3);
  await expect(banner(page)).toContainText('Read-only');

  // The cards can't be edited, added to or dragged until the slice is reopened
  await expect(firstSlice(page).locator('textarea, .btn-add-story, .btn-options')).toHaveCount(0);
  await expect(firstSliceCards(page).first()).toHaveText('Drinks by category');

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

test('reopening a peeked slice makes its cards editable', async ({ page, createMap }) => {
  await openMap(page, await createMap(MAP));
  await peekToggle(page).click();
  await expect(firstSlice(page).locator('textarea')).toHaveCount(0);
  await firstSlice(page).locator('.btn-slice-menu').click();
  await page.getByRole('button', { name: /Reopen/ }).click();
  await expect(firstSlice(page)).not.toHaveClass(/slice-peeking|slice-collapsed/);
  await expect(firstSlice(page).locator('.story-card textarea')).toHaveCount(3);
});

test('the banner stays in place under the frozen rows when the cards show', async ({ page, createMap }) => {
  // Cards above and below the closed slice, so the map scrolls both ways
  const cards = (label) => Array.from({ length: 10 }, (_, i) => `        - name: ${label} ${i + 1}`).join('\n');
  const id = await createMap(`name: Long map
users:
  - name: Customer
activities:
  - name: Order coffee
steps:
  - Browse
  - Order
slices:
  - name: Phase 0
    stories:
      Browse:
${cards('Early')}
  - name: Phase 1
    collapsed: true
    closedReason: complete
    stories:
      Browse:
${cards('Done')}
  - name: Phase 2
    stories:
      Order:
${cards('Later')}
`);
  await openMap(page, id, 2);
  const gap = () => page.evaluate(() =>
    document.querySelector('.slice-completed-banner').getBoundingClientRect().top
    - document.querySelector('.map-top').getBoundingClientRect().bottom);
  // Scroll until the banner sits right under the frozen rows
  await page.locator('#storyMapWrapper').evaluate((w) => {
    w.scrollTop += document.querySelector('.slice-completed-banner').getBoundingClientRect().top
      - document.querySelector('.map-top').getBoundingClientRect().bottom - 5;
  });
  const before = await gap();
  await page.locator('.slice-peek-toggle').click();
  await expect(page.locator('.slice-peeking .story-card')).toHaveCount(10);
  expect(Math.abs((await gap()) - before)).toBeLessThan(2);
});
