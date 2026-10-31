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

test('a map opened from a scrolled home page starts with the header in view', async ({ page }) => {
  // Phones measure 100vh with the address bar hidden, so with the bar showing the map page is
  // taller than the screen. The emulated phone has no bar, so make the page 56px taller
  await page.goto('/');
  await page.addStyleTag({ content: 'body:not(.welcome-visible) { height: calc(100vh + 56px) !important; }' });
  await page.evaluate(() => window.scrollTo(0, 3000));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(56);
  await page.locator('.welcome-screen [data-sample="recipe-app"]').tap();
  await expect(page.locator('.story-map-wrapper')).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator('#menuBtn')).toBeInViewport();
});
