import { test, expect, openMap } from './fixtures.js';

const isDark = (page) => page.evaluate(() => document.documentElement.classList.contains('dark-mode'));
const heroSrc = (page) => page.locator('.welcome-hero-img').evaluate(img => new URL(img.currentSrc).pathname);

test('the home page switches between light and dark from the menu, with a screenshot to match', async ({ page }) => {
  await page.addInitScript(() => { if (localStorage.getItem('darkMode') === null) localStorage.setItem('darkMode', 'false'); });
  await page.goto('/');
  await expect(page.locator('#welcomeNewBtn')).toBeVisible();
  expect(await isDark(page)).toBe(false);
  await expect.poll(() => heroSrc(page)).toBe('/resources/screenshot.png');

  await page.locator('#menuBtn').click();
  await expect(page.locator('#themeMenuBtn')).toHaveText(/Dark mode/);
  await page.locator('#themeMenuBtn').click();
  await expect(page.locator('#mainMenu')).toBeHidden();
  expect(await isDark(page)).toBe(true);
  await expect.poll(() => heroSrc(page)).toBe('/resources/screenshot-dark.png');

  // The choice is kept, and the dark screenshot is the one loaded next time
  await page.reload();
  expect(await isDark(page)).toBe(true);
  await expect.poll(() => heroSrc(page)).toBe('/resources/screenshot-dark.png');
  await page.locator('#menuBtn').click();
  await expect(page.locator('#themeMenuBtn')).toHaveText(/Light mode/);
  await page.locator('#themeMenuBtn').click();
  expect(await isDark(page)).toBe(false);
  await expect.poll(() => heroSrc(page)).toBe('/resources/screenshot.png');
});

test('a map keeps the theme switch in its view controls, not the menu', async ({ page, createMap }) => {
  const id = await createMap('name: Ordering\nsteps:\n  - Browse\n  - Order\n  - Pay\n');
  await openMap(page, id);
  await page.locator('#menuBtn').click();
  await expect(page.locator('#mainMenu')).toBeVisible();
  await expect(page.locator('#themeMenuBtn')).toBeHidden();
});
