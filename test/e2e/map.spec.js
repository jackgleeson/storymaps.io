import { test, expect, openMap, stepNames, cardNames, addCard } from './fixtures.js';

test('opens a map and shows its steps and cards', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  await expect(page.locator('#boardName')).toHaveValue('Coffee app');
  expect(await stepNames(page)).toEqual(['Browse', 'Order', 'Pay']);
  expect(await cardNames(page)).toEqual(['One', 'Two', 'Three']);
});

test('a card added in the browser is saved', async ({ page, createMap, pullMap }) => {
  const id = await createMap();
  await openMap(page, id);
  await addCard(page, 'Oat milk', 1);
  await expect.poll(async () => (await pullMap(id)).slices[0].stories[1].map(c => c.name)).toEqual(['Pick size', 'Oat milk']);

  await page.reload();
  await expect.poll(() => cardNames(page, 1)).toEqual(['Pick size', 'Oat milk']);
});

test('the welcome page opens and a new map can be started from it', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toHaveClass(/welcome-visible/);
  await page.locator('#welcomeNewBtn').click();
  await expect(page).toHaveURL(/\/[0-9a-z]{8}$/);
  await expect(page.locator('.step')).not.toHaveCount(0);
});

test('the map header fits between a phone and a laptop, with the menu button in view', async ({ page, createMap }) => {
  const id = await createMap();
  for (const width of [620, 760, 880]) {
    await page.setViewportSize({ width, height: 700 });
    await openMap(page, id);
    const right = await page.locator('#menuBtn').evaluate(b => b.getBoundingClientRect().right);
    expect(right).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  }
});

// The room above the map: the whole window when the map fits, a small strip when it doesn't
const mapOfSlices = (count) => `name: Heights
steps:
  - One
  - Two
slices:
${Array.from({ length: count }, (_, i) => `  - name: Slice ${i}
    stories:
      One:
        - name: Card A${i}
        - name: Card B${i}
`).join('')}`;

const scrollToTop = async (page) => {
  await page.locator('#storyMapWrapper').evaluate(w => { w.scrollTop = 0; });
  await page.evaluate(() => new Promise(requestAnimationFrame));
};

const mapEdges = (page) => page.evaluate(() => {
  const wrapper = document.getElementById('storyMapWrapper');
  const map = document.getElementById('storyMap');
  const area = wrapper.getBoundingClientRect();
  return {
    top: map.getBoundingClientRect().top - area.top,
    bottom: map.querySelector(':scope > .map-body').getBoundingClientRect().bottom - area.top,
    height: wrapper.clientHeight,
  };
});

test('scrolling up stops just above a map taller than the window', async ({ page, createMap }) => {
  await openMap(page, await createMap(mapOfSlices(12)), 2);
  await scrollToTop(page);
  const { top, bottom, height } = await mapEdges(page);
  expect(bottom).toBeGreaterThan(height);
  expect(top).toBeGreaterThanOrEqual(0);
  expect(top).toBeLessThanOrEqual(61);
});

test('a map that fits in the window can move to its bottom edge, but no further', async ({ page, createMap }) => {
  await openMap(page, await createMap(mapOfSlices(1)), 2);
  await scrollToTop(page);
  const { top, bottom, height } = await mapEdges(page);
  expect(top).toBeGreaterThan(61);
  expect(Math.abs(bottom - height)).toBeLessThanOrEqual(2);
});

test('zooming out a tall map frees the room above it and keeps the middle of the view still', async ({ page, createMap }) => {
  await openMap(page, await createMap(mapOfSlices(12)), 2);
  const wrapper = page.locator('#storyMapWrapper');
  await wrapper.evaluate((w) => {
    w.scrollTop = document.getElementById('storyMap').offsetTop + 300;
  });
  const middle = () => page.evaluate(() => {
    const w = document.getElementById('storyMapWrapper');
    const map = document.getElementById('storyMap');
    const zoom = parseFloat(map.style.getPropertyValue('--zoom')) || 1;
    return (w.getBoundingClientRect().top + w.clientHeight / 2 - map.getBoundingClientRect().top) / zoom;
  });
  const before = await middle();
  await page.locator('#zoomOut').click();
  expect(Math.abs(await middle() - before)).toBeLessThanOrEqual(3);

  for (let i = 0; i < 8; i++) await page.locator('#zoomOut').click();
  await scrollToTop(page);
  const { top, bottom, height } = await mapEdges(page);
  expect(bottom).toBeLessThanOrEqual(height + 2);
  expect(top).toBeGreaterThan(61);
});

test('a map that grows past the window loses the extra room', async ({ page, createMap }) => {
  await openMap(page, await createMap(mapOfSlices(1)), 2);
  await scrollToTop(page);
  expect((await mapEdges(page)).top).toBeGreaterThan(61);

  for (let i = 0; i < 10; i++) await addCard(page, `Card ${i}`);
  await scrollToTop(page);
  expect((await mapEdges(page)).top).toBeLessThanOrEqual(61);
});
