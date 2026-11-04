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

// Cards above and below a closed slice, so the map scrolls both ways
const openLongMap = async (page, createMap) => {
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
  // Scroll until the banner sits right under the frozen rows
  await page.locator('#storyMapWrapper').evaluate((w) => {
    w.scrollTop += document.querySelector('.slice-completed-banner').getBoundingClientRect().top
      - document.querySelector('.map-top').getBoundingClientRect().bottom - 5;
  });
  // The browser only picks what to keep in place on scroll at its next frames
  await page.waitForTimeout(300);
};
const sliceTop = (page, i) => page.locator('.slice-container').nth(i).evaluate(el => el.getBoundingClientRect().top);

test('the banner stays in place under the frozen rows when the cards show', async ({ page, createMap }) => {
  await openLongMap(page, createMap);
  const before = await sliceTop(page, 1);
  await page.locator('.slice-peek-toggle').click();
  await expect(page.locator('.slice-peeking .story-card')).toHaveCount(10);
  expect(Math.abs((await sliceTop(page, 1)) - before)).toBeLessThan(2);
});

test('reopening a slice under the frozen rows keeps it in place', async ({ page, createMap }) => {
  await openLongMap(page, createMap);
  const before = await sliceTop(page, 1);
  await page.locator('.slice-collapsed .btn-slice-menu').click();
  await page.getByRole('button', { name: 'Reopen' }).click();
  await expect(page.locator('.slice-container').nth(1).locator('.story-card textarea')).toHaveCount(10);
  expect(Math.abs((await sliceTop(page, 1)) - before)).toBeLessThan(2);
});

test('showing and hiding the cards keeps the story map where it was', async ({ page, createMap }) => {
  // Wider than the window, so the browser could scroll it sideways
  const steps = Array.from({ length: 12 }, (_, i) => `Step ${i + 1}`);
  await openMap(page, await createMap(`name: Wide map
steps:
${steps.map(s => `  - ${s}`).join('\n')}
slices:
  - name: Phase 1
    collapsed: true
    closedReason: complete
    stories:
      Step 1:
        - name: Drinks by category
        - name: Search by name
      Step 12:
        - name: Card payment
  - name: Phase 2
    stories:
      Step 2:
        - name: Pick size
`), 12);
  const position = () => page.locator('#storyMapWrapper').evaluate(w => [w.scrollLeft, w.scrollTop]);
  const before = await position();
  await peekToggle(page).click();
  await expect(firstSliceCards(page)).toHaveCount(3);
  await peekToggle(page).click();
  await expect(firstSliceCards(page)).toHaveCount(0);
  expect(await position()).toEqual(before);
});

test('links on cards open from a peeked slice and from a locked map', async ({ page, createMap, request }) => {
  const id = await createMap(MAP.replace('        - name: Card payment', '        - name: Card payment\n          url: https://example.com/ticket'));
  await request.post(`/api/lock/${id}`, { data: { passwordHash: createHash('sha256').update('elsewhere').digest('hex') } });
  await openMap(page, id);
  await peekToggle(page).click();
  const link = firstSlice(page).locator('.url-indicator');
  await expect(link).toHaveAttribute('href', 'https://example.com/ticket');
  // A click reaches the link rather than the column under it
  expect(await link.evaluate(a => {
    const r = a.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === a;
  })).toBe(true);
});

// Phase 1 is closed, and three of its five cards sit in the Checkout partial
const PARTIAL_MAP = {
  name: 'Partial map',
  steps: [{ name: 'Browse' }, { partialMapId: 'pm000001', partialMapOrigin: true }, { name: 'Pay' }],
  slices: [
    { name: 'Phase 1', collapsed: true, closedReason: 'complete', stories: [[{ name: 'Menu' }], [], [{ name: 'Card' }]] },
    { name: 'Phase 2', stories: [[], [], []] },
  ],
  partialMaps: [{
    id: 'pm000001', name: 'Checkout', users: [[], []], activities: [[], []],
    steps: [{ name: 'Basket' }, { name: 'Address' }],
    stories: [[[{ name: 'Edit basket' }, { name: 'Promo code' }], [{ name: 'Postcode lookup' }]], [[], []]],
  }],
};
const createPartialMap = async (request) => (await (await request.post('/api/maps', { data: PARTIAL_MAP })).json()).id;

test('showing the cards of a closed slice brings back the steps of a partial holding some of them', async ({ page, request }) => {
  await openMap(page, await createPartialMap(request), 3);
  await peekToggle(page).click();
  await expect(page.locator('.step')).toHaveCount(4);
  await expect(firstSliceCards(page)).toHaveText(['Menu', 'Edit basket', 'Promo code', 'Postcode lookup', 'Card']);
  await peekToggle(page).click();
  await expect(page.locator('.step')).toHaveCount(3);
  await expect(firstSliceCards(page)).toHaveCount(0);
});

test('a slice with cards in a collapsed partial says how many, and showing them brings back its steps', async ({ page, request }) => {
  const map = structuredClone(PARTIAL_MAP);
  map.slices[0] = { name: 'Phase 1', stories: [[{ name: 'Menu' }], [], [{ name: 'Card' }]] };
  map.partialMaps[0].stories[1] = [[{ name: 'Gift wrap' }], []];
  const id = (await (await request.post('/api/maps', { data: map })).json()).id;
  await openMap(page, id, 3);

  const toggle = (i) => page.locator('.slice-container').nth(i).locator('.partial-cards-toggle');
  await expect(toggle(0)).toHaveText('Show 3 cards');
  await expect(toggle(1)).toHaveText('Show 1 card');
  await toggle(0).click();
  await expect(page.locator('.step')).toHaveCount(4);
  await expect(page.locator('.partial-cards-toggle')).toHaveCount(0);
  await expect(page.locator('.slice-container').nth(1).locator('.story-card')).toHaveText(['Gift wrap']);

  // The strip across the partial's steps names it and folds it away again
  await expect(page.locator('.partial-expanded-bar')).toContainText('Checkout');
  await page.locator('.partial-expanded-bar').getByRole('button', { name: 'Hide cards' }).click();
  await expect(page.locator('.step')).toHaveCount(3);
  await expect(toggle(0)).toHaveText('Show 3 cards');
});

test('the Overview counts the cards and steps inside partials', async ({ page, request }) => {
  const map = structuredClone(PARTIAL_MAP);
  map.slices[0] = { name: 'Phase 1', stories: [[{ name: 'Menu', status: 'done' }], [], [{ name: 'Card' }]] };
  map.partialMaps[0].stories[0][0][0].status = 'done';
  const id = (await (await request.post('/api/maps', { data: map })).json()).id;
  await openMap(page, id, 3);
  const panel = page.locator('#legendPanel');
  if (!(await panel.isVisible())) await page.locator('#legendToggle').click();
  await expect(panel.locator('.map-stats-tile').nth(0)).toHaveText('5cards');
  await expect(panel.locator('.map-stats-tile').nth(1)).toHaveText('4steps');
  await expect(panel.locator('.map-stats-slice').first().locator('.map-stats-slice-count')).toHaveText('2/5');
});

test('the card count of a closed slice counts partial cards once, even while the partial is edited', async ({ page, request }) => {
  await openMap(page, await createPartialMap(request), 3);
  await expect(banner(page)).toContainText('5 cards');

  const panel = page.locator('#legendPanel');
  if (!(await panel.isVisible())) await page.locator('#legendToggle').click();
  await page.getByRole('button', { name: 'Partials' }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('.step')).toHaveCount(4);
  await expect(banner(page)).toContainText('5 cards');
});
