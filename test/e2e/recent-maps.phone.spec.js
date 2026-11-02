import { test, expect, openMap } from './fixtures.js';

const map = (name) => `name: ${name}
steps:
  - Browse
  - Order
`;

const list = (page) => page.locator('#recentMapsPop');

test('on a phone the recent maps sheet closes with back, its close button or a tap above it, and back still leaves the site after', async ({ page, createMap }) => {
  const id = await createMap(map('Ordering'));
  await openMap(page, id, 2);
  await page.goto('/');
  const start = await page.evaluate(() => history.length);

  // Back closes the sheet and keeps the home page
  await page.locator('#recentMapsBtn').tap();
  await expect(list(page)).toBeVisible();
  await page.goBack();
  await expect(list(page)).toBeHidden();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('#welcomeNewBtn')).toBeVisible();

  // The close button
  await page.locator('#recentMapsBtn').tap();
  await list(page).getByRole('button', { name: 'Close recent maps' }).tap();
  await expect(list(page)).toBeHidden();

  // A tap on the shade above the sheet
  await page.locator('#recentMapsBtn').tap();
  await page.locator('.recent-shade').tap({ position: { x: 20, y: 20 } });
  await expect(list(page)).toBeHidden();

  // Closing it takes back its history entry, so the next back leaves the home page as before
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => history.state?.recentList)).toBeFalsy();
  expect(await page.evaluate(() => history.length)).toBe(start + 1);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/${id}$`));
});

test('on a phone a map opened from the sheet comes back to the home page, not the open sheet', async ({ page, createMap }) => {
  const id = await createMap(map('Ordering'));
  await openMap(page, id, 2);
  await page.goto('/');
  await page.locator('#recentMapsBtn').tap();
  await list(page).locator('.recent-row').tap();
  await expect(page.locator('#boardName')).toHaveValue('Ordering');
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('#welcomeNewBtn')).toBeVisible();
  await expect(list(page)).toBeHidden();
});
