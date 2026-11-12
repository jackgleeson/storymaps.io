import { test, expect, openMap } from './fixtures.js';

const PAGES = [['Docs', '/docs', 'Contents']];

test('the home page header links lead to their pages', async ({ page }) => {
  for (const [name, path, heading = name] of PAGES) {
    await page.goto('/');
    await page.locator('.header-links').getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(path);
    await expect(page.locator('h1')).toHaveText(heading);
  }
});

test('on a narrow map the links are in the main menu', async ({ page, createMap }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await openMap(page, await createMap());
  await expect(page.locator('.header-links')).toBeHidden();
  await page.locator('#menuBtn').click();
  await page.locator('.menu-links').getByRole('link', { name: 'Docs' }).click();
  await expect(page).toHaveURL('/docs');
});

test('Docs is a plain link, and a docs page marks it as the one it belongs to', async ({ page }) => {
  for (const path of ['/', '/docs/plan-releases-with-story-map-slices']) {
    await page.goto(path);
    const links = page.locator('.header-links');
    await links.getByRole('link', { name: 'Docs', exact: true }).hover();
    await expect(page.locator('.docs-menu-panel')).toHaveCount(0);
    const current = path.startsWith('/docs') ? 'Docs' : null;
    // No Learn link until there are courses
    await expect(links.getByRole('link', { name: 'Learn', exact: true })).toHaveCount(0);
    for (const name of ['Docs']) {
      const link = links.getByRole('link', { name, exact: true });
      if (name === current) await expect(link).toHaveAttribute('aria-current', 'page');
      else await expect(link).not.toHaveAttribute('aria-current');
    }
  }
});
