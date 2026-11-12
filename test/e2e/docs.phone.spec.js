import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const index = JSON.parse(readFileSync(new URL('../../public/docs/search.json', import.meta.url), 'utf-8'));
// A guide page, with the docs menu: not a lesson, and not the why page
const guide = index.find(p => p.url.startsWith('/docs/') && p.url !== '/docs/why-user-story-mapping');

test('on a phone the guides are in a menu that opens and closes', async ({ page }) => {
  await page.goto(guide.url);
  const menu = page.locator('#docsNav');
  await expect(menu).toBeHidden();
  await page.getByRole('button', { name: 'Open the docs menu' }).tap();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('link', { name: guide.title, exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Close the docs menu' }).tap();
  await expect(menu).toBeHidden();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBe(0);
});

test('on a phone a CLI page fits the screen, with long output scrolling inside its terminal', async ({ page }) => {
  for (const p of index.filter(p => p.url.startsWith('/docs/cli/'))) {
    await page.goto(p.url);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow, p.url).toBe(0);
  }
  await page.goto(index.find(p => p.url.startsWith('/docs/cli/')).url);
  await page.getByRole('button', { name: 'Open the docs menu' }).tap();
  await expect(page.locator('#docsNav .docs-switch a[aria-current]')).toContainText('CLI');
});
