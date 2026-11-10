import { test, expect, openMap } from './fixtures.js';

test('the expanded card title is one line high, and grows when the title wraps', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  const card = page.locator('.slice-container .story-card').first();
  await card.hover();
  await card.locator('.btn-expand').click();
  const title = page.locator('#cardExpandName');
  await expect(title).toBeVisible();

  const lineHeight = await title.evaluate(t => parseFloat(getComputedStyle(t).lineHeight));
  await expect.poll(() => title.evaluate(t => t.offsetHeight)).toBeLessThan(lineHeight * 1.5);

  await title.fill('A long card title that keeps going until it has to wrap onto a second line of the expanded card');
  await expect.poll(() => title.evaluate(t => t.offsetHeight)).toBeGreaterThan(lineHeight * 1.5);
});

const openCard = async (card) => {
  await card.hover();
  await card.locator('.btn-expand').click();
};
const place = (page) => page.locator('#cardExpandPlace');
const placeParts = (page) => place(page).locator('.card-expand-place-part');

test('the expanded card says which step and slice it is in', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  await openCard(page.locator('.slice-container .story-card').last());
  await expect(placeParts(page)).toHaveText(['Pay', 'MVP']);
});

test('a card in a slice with no name says so', async ({ page, createMap }) => {
  await openMap(page, await createMap('name: Blank\nsteps:\n  - Browse\nslices:\n  - name: \"\"\n    stories:\n      Browse:\n        - name: One\n'), 1);
  await openCard(page.locator('.slice-container .story-card').first());
  await expect(placeParts(page)).toHaveText(['Browse', 'Unnamed slice']);
});

test('a card in the users row shows no place, and keeps the close button', async ({ page, createMap }) => {
  await openMap(page, await createMap('name: Users\nsteps:\n  - Browse\nusers:\n  - name: Home cook\n    step: Browse\nslices:\n  - name: MVP\n    stories:\n      Browse:\n        - name: One\n'), 1);
  await openCard(page.locator('.users-row .story-card').first());
  await expect(page.locator('#cardExpandModal')).toHaveClass(/visible/);
  await expect(placeParts(page)).toHaveCount(0);
  await expect(page.locator('#cardExpandModalClose')).toBeVisible();
});

test('a card inside a partial shows the name of the partial', async ({ page, request }) => {
  const map = {
    name: 'Partial map',
    steps: [{ partialMapId: 'pm000001', partialMapOrigin: true }, { name: 'Pay' }],
    slices: [{ name: 'Phase 1', stories: [[], [{ name: 'Card' }]] }],
    partialMaps: [{
      id: 'pm000001', name: 'Checkout', users: [[]], activities: [[]],
      steps: [{ name: 'Basket' }],
      stories: [[[{ name: 'Edit basket', body: 'Change quantities' }]]],
    }],
  };
  const id = (await (await request.post('/api/maps', { data: map })).json()).id;
  await openMap(page, id, 2);
  await page.locator('.partial-cards-toggle').first().click();
  await page.locator('.partial-map-preview-col .story-card .btn-expand').first().click();
  await expect(placeParts(page)).toHaveText(['Checkout']);
});

test('long step and slice names stay on one line and leave the buttons in place', async ({ page, createMap }) => {
  const long = 'A very long name that goes on and on and on, well past the width of the expanded card itself';
  await openMap(page, await createMap(`name: Long\nsteps:\n  - ${long} step\nslices:\n  - name: ${long} slice\n    stories:\n      ${long} step:\n        - name: One\n`), 1);
  await openCard(page.locator('.slice-container .story-card').first());
  const header = await page.locator('.card-expand-modal .modal-header').boundingBox();
  expect(header.height).toBeLessThanOrEqual(35);
  const close = await page.locator('#cardExpandModalClose').boundingBox();
  expect(close.x + close.width).toBeLessThanOrEqual(header.x + header.width);
  const placeBox = await place(page).boundingBox();
  const link = await page.locator('#cardExpandCopyLink').boundingBox();
  expect(placeBox.x + placeBox.width).toBeLessThanOrEqual(link.x);
});

const closedSliceMap = (slice, step = 'Pay') => ({
  name: 'Closed',
  steps: [{ name: step }],
  slices: [{ collapsed: true, stories: [[{ name: 'Card', body: 'Details' }]], ...slice }, { name: 'Next', stories: [[]] }],
});
const openPeekedCard = async (page, request, map) => {
  const id = (await (await request.post('/api/maps', { data: map })).json()).id;
  await openMap(page, id, 1);
  await page.getByRole('button', { name: /Show cards/ }).first().click();
  await page.locator('.slice-peek-col .story-card .btn-expand').first().click();
  await expect(page.locator('#cardExpandModal')).toHaveClass(/visible/);
};
const status = (page) => place(page).locator('.card-expand-place-status');

test('a card in a complete or closed slice says so after the slice name', async ({ page, request }) => {
  await openPeekedCard(page, request, closedSliceMap({ name: 'Phase 1', closedReason: 'complete' }));
  await expect(placeParts(page)).toHaveText(['Pay', 'Phase 1']);
  await expect(status(page)).toHaveText('(complete)');

  await page.locator('#cardExpandModalClose').click();
  await openPeekedCard(page, request, closedSliceMap({ name: 'Phase 2', closedReason: 'closed' }));
  await expect(status(page)).toHaveText('(closed)');
});

test('a card in an open slice shows no status', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  await openCard(page.locator('.slice-container .story-card').first());
  await expect(placeParts(page)).toHaveCount(2);
  await expect(status(page)).toHaveCount(0);
});

test('when names are too long the step shrinks first and the status is never cut', async ({ page, request }) => {
  const long = 'A very long name that goes on and on and on, well past the width of the expanded card itself';
  await openPeekedCard(page, request, closedSliceMap({ name: `${long} slice`, closedReason: 'complete' }, `${long} step`));

  const box = (locator) => locator.boundingBox();
  const placeBox = await box(place(page));
  const [step, name] = [await box(placeParts(page).nth(0)), await box(placeParts(page).nth(1))];
  const statusBox = await box(status(page));
  expect(statusBox.x + statusBox.width).toBeLessThanOrEqual(placeBox.x + placeBox.width + 1);
  expect(await status(page).evaluate(s => s.scrollWidth <= s.clientWidth)).toBe(true);
  expect(step.width).toBeGreaterThanOrEqual(30);
  expect(name.width).toBeGreaterThan(step.width * 3);
  expect((await box(page.locator('.card-expand-modal .modal-header'))).height).toBeLessThanOrEqual(35);
});

test('a short step keeps its whole name beside a long slice name', async ({ page, request }) => {
  const long = 'A very long name that goes on and on and on, well past the width of the expanded card itself';
  await openPeekedCard(page, request, closedSliceMap({ name: long, closedReason: 'closed' }));
  await expect(placeParts(page).first()).toHaveText('Pay');
  expect(await placeParts(page).first().evaluate(s => s.scrollWidth <= s.clientWidth)).toBe(true);
});

const colours = (page) => page.evaluate(() => {
  const style = (selector) => getComputedStyle(document.querySelector(selector));
  return {
    backdrop: style('#cardExpandModal').backgroundColor,
    card: style('.card-expand-modal').backgroundColor,
    title: style('#cardExpandName').color,
    body: style('#cardExpandBody').color,
  };
});
const BACKDROP = 'rgba(0, 0, 0, 0.35)';
const NEAR_BLACK = 'rgb(26, 26, 26)';

test('the expanded card keeps its colour, with near-black text', async ({ page, createMap }) => {
  await openMap(page, await createMap('name: Users\nsteps:\n  - Browse\nusers:\n  - name: Home cook\n    step: Browse\n    color: "#fca5a5"\nslices:\n  - name: MVP\n    stories:\n      Browse:\n        - name: One\n'), 1);
  await openCard(page.locator('.users-row .story-card').first());
  expect(await colours(page)).toEqual({ backdrop: BACKDROP, card: 'rgb(252, 165, 165)', title: NEAR_BLACK, body: NEAR_BLACK });
});

test('changing the colour of an open card changes the card and keeps the text near-black', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  await openCard(page.locator('.slice-container .story-card').first());
  await page.locator('#cardExpandFooter .card-expand-toggle').click();
  await page.locator('.card-expand-swatch[title="blue"]').click();
  expect(await colours(page)).toEqual({ backdrop: BACKDROP, card: 'rgb(147, 197, 253)', title: NEAR_BLACK, body: NEAR_BLACK });
});

test('placeholder text is clearly fainter than real text', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  await openCard(page.locator('.slice-container .story-card').first());
  const placeholder = await page.locator('#cardExpandBody').evaluate(body => getComputedStyle(body, '::placeholder').color);
  expect(placeholder).toBe('rgba(0, 0, 0, 0.42)');
});

test('a link in the closed footer is blue, and underlined only on hover', async ({ page, createMap }) => {
  await openMap(page, await createMap('name: Links\nsteps:\n  - Browse\nslices:\n  - name: MVP\n    stories:\n      Browse:\n        - name: One\n          url: https://example.com/a\n'), 1);
  await openCard(page.locator('.slice-container .story-card').first());
  const link = page.locator('.card-expand-summary-link');
  const style = () => link.evaluate(a => ({ color: getComputedStyle(a).color, line: getComputedStyle(a).textDecorationLine }));
  await page.locator('#cardExpandName').hover();
  expect(await style()).toEqual({ color: 'rgb(3, 105, 161)', line: 'none' });
  await link.hover();
  expect((await style()).line).toBe('underline');
});
