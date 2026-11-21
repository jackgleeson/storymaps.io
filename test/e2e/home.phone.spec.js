import { test, expect } from './fixtures.js';

test('on a phone the rows stack and nothing runs off the side', async ({ page }) => {
  await page.goto('/');
  const row = page.locator('.welcome-about-row').first();
  await row.scrollIntoViewIfNeeded();
  const [shot, text] = [await row.locator('.welcome-about-shot').boundingBox(), await row.locator('.welcome-about-text').boundingBox()];
  expect(text.y).toBeGreaterThan(shot.y + shot.height - 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
