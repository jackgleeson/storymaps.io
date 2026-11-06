import { test, expect, openMap, cardNames, addCard } from './fixtures.js';

test('a card added by one person appears for the other', async ({ page, createMap, openSecondTab }) => {
  const id = await createMap();
  const other = await openSecondTab();
  await openMap(page, id);
  await openMap(other, id);

  await addCard(page, 'Live card');
  await expect.poll(() => cardNames(other)).toEqual(['One', 'Two', 'Three', 'Live card']);
});

test('cards added while one person is offline merge without duplicates', async ({ page, createMap, openSecondTab }) => {
  const id = await createMap();
  const other = await openSecondTab();
  await openMap(page, id);
  await openMap(other, id);

  await other.context().setOffline(true);
  await addCard(page, 'From A');
  await addCard(other, 'From B');
  await other.context().setOffline(false);

  // Each card once, in the same order for both people
  const sorted = async (p) => [...await cardNames(p)].sort();
  await expect.poll(() => sorted(page), { timeout: 15_000 }).toEqual(['From A', 'From B', 'One', 'Three', 'Two']);
  await expect.poll(() => sorted(other), { timeout: 15_000 }).toEqual(['From A', 'From B', 'One', 'Three', 'Two']);
  expect(await cardNames(other)).toEqual(await cardNames(page));
});

test('dragging a card reorders it for both people', async ({ page, createMap, openSecondTab }) => {
  const id = await createMap();
  const other = await openSecondTab();
  await openMap(page, id);
  await openMap(other, id);

  const cards = page.locator('.slice-container').first().locator('.story-column').first().locator('.story-card');
  const from = await cards.nth(2).boundingBox();
  const to = await cards.nth(0).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + 6);
  await page.mouse.down();
  for (let step = 1; step <= 15; step++) {
    await page.mouse.move(from.x + from.width / 2, from.y + 6 + (to.y - from.y - 4) * step / 15);
  }
  await page.mouse.up();

  await expect.poll(() => cardNames(page)).toEqual(['Three', 'One', 'Two']);
  await expect.poll(() => cardNames(other)).toEqual(['Three', 'One', 'Two']);
});

test('one person with several tabs open counts once', async ({ page, createMap, openSecondTab }) => {
  const id = await createMap();
  await openMap(page, id);
  // More tabs in the same browser share its storage, so they are the same person
  const sameBrowser = await page.context().newPage();
  await openMap(sameBrowser, id);
  const live = page.locator('#viewerLive');
  await expect(page.locator('#viewerName')).toHaveText('Tester');
  await expect(live).not.toHaveClass(/visible/);

  // Someone else in another browser makes two
  const other = await openSecondTab();
  await openMap(other, id);
  await expect(live).toHaveText('2');
  await expect(other.locator('#viewerLive')).toHaveText('2');
  await expect(other.locator('#viewerLive')).toHaveAttribute('data-tooltip', 'Tester (you)\nTester');
});
