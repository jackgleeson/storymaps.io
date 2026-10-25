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
