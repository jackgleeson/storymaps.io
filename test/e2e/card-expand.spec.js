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
