import { test, expect } from '@playwright/test';

test('on a phone the home page links are icons on the same row as the logo', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tourCompleted', 'true'));
  await page.goto('/');
  const links = page.locator('.header-links .header-link');
  await expect(links).toHaveCount(2);
  await expect(page.locator('.header-links .header-link-label').first()).toBeHidden();
  const logo = await page.locator('.logo').boundingBox();
  const menu = await page.locator('#menuBtn').boundingBox();
  for (const link of await links.all()) {
    const box = await link.boundingBox();
    expect(Math.abs((box.y + box.height / 2) - (logo.y + logo.height / 2))).toBeLessThan(6);
  }
  expect(Math.abs((menu.y + menu.height / 2) - (logo.y + logo.height / 2))).toBeLessThan(6);
  await expect(page.locator('.header-links').getByRole('link', { name: 'Docs', exact: true })).toBeVisible();
  await expect(page.locator('.header-links').getByRole('link', { name: 'Developers', exact: true })).toBeVisible();
});
