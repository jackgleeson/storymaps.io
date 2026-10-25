import { test, expect, openMap } from './fixtures.js';

test('a map fits the phone screen without scrolling sideways', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('tapping a step menu opens it with Delete Column', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  await page.locator('.step').first().locator('.btn-options').tap();
  const menu = page.locator('.options-menu.visible');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.options-delete-column')).toBeVisible();
  const box = await menu.boundingBox();
  const viewport = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
});

test('the main menu opens on a phone', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  await page.locator('#menuBtn').tap();
  await expect(page.locator('#newMapBtn')).toBeVisible();
});
