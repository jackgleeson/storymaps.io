import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Each test picks its page from the built docs, so rewording or adding pages needs no change here
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf-8');
const index = JSON.parse(read('public/docs/search.json'));
const built = (url) => read(`public${url}.html`);
const withShot = index.find(p => built(p.url).includes('class="shot'));
const withMap = index.find(p => /href="\/sample\/[^"]+"/.test(built(p.url)));

test('the docs home lists every section, and search finds a heading inside a page', async ({ page }) => {
  await page.goto('/docs');
  await expect(page.locator('.contents-sec')).toHaveCount(built('/docs/index').match(/class="contents-sec"/g).length);
  // The why page comes first, for anyone new
  await expect(page.locator('.contents-sec a').first()).toHaveAttribute('href', '/docs/why-user-story-mapping');
  // A guide heading: the why page's heading reads like a page title, which search ranks higher
  const target = index.find(p => p.headings.length && p.url !== '/docs/why-user-story-mapping');
  const heading = target.headings[0];
  await page.keyboard.press('/');
  await page.keyboard.type(heading.text);
  await expect(page.locator('.search-results a').first()).toContainText(heading.text);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${target.url}#${heading.id}`);
});

test('the switch moves between the web app and CLI docs, and search finds CLI pages labelled as CLI', async ({ page }) => {
  await page.goto('/docs');
  await page.locator('.contents-top .docs-switch a[href="/docs/cli"]').click();
  await expect(page).toHaveURL('/docs/cli');
  await expect(page.locator('.contents-top .docs-switch a[aria-current]')).toContainText('CLI');
  const cli = index.find(p => p.url.startsWith('/docs/cli/'));
  await page.locator(`.contents-sec a[href="${cli.url}"]`).click();
  await expect(page.locator('.docs-side .docs-switch a[aria-current]')).toContainText('CLI');
  await page.locator('.docs-side .docs-switch a[href="/docs"]').click();
  await expect(page).toHaveURL('/docs');
  await page.keyboard.press('/');
  await page.keyboard.type(cli.title);
  await expect(page.locator(`.search-results a[href="${cli.url}"]`)).toContainText(cli.section);
  expect(cli.section).toMatch(/^CLI: /);
});

test('Copy on a terminal copies its commands without the prompt', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'clipboard permissions are Chromium only');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const withTerm = index.find(p => p.url.startsWith('/docs/cli/') && (built(p.url).match(/data-cmd>/g) || []).length > 1 && built(p.url).includes('Copy the commands'));
  await page.goto(withTerm.url);
  const term = page.locator('.term', { has: page.locator('[aria-label="Copy the commands"]') }).first();
  const commands = await term.locator('[data-cmd]').evaluateAll(els => els.map(e => e.textContent.replace(/^\$ /, '')).join('\n'));
  await term.locator('[data-copy]').click();
  await expect(term.locator('[data-copy] span')).toHaveText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(commands);
  expect(commands).not.toMatch(/^\$/m);
});

test('following a link and going back returns to the same place in the page', async ({ page }) => {
  await page.goto('/docs/create-a-user-story-map');
  const link = page.locator('.docs-article a[href="/docs/customise-story-map-cards"]').first();
  await link.scrollIntoViewIfNeeded();
  const panel = page.locator('#docsScroll');
  await expect.poll(() => panel.evaluate(p => p.scrollTop)).toBeGreaterThan(100);
  const was = await panel.evaluate(p => p.scrollTop);
  await link.click();
  await expect(page).toHaveURL(/customise-story-map-cards/);
  await page.goBack();
  await expect(page).toHaveURL(/create-a-user-story-map/);
  await expect.poll(() => panel.evaluate(p => p.scrollTop)).toBeCloseTo(was, -1);
});

test('a screenshot follows the theme, and the theme switch changes both', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('darkMode', 'false'));
  await page.goto(withShot.url);
  const light = page.locator('.shot img.only-light').first();
  const dark = page.locator('.shot img.only-dark').first();
  await expect(light).toBeVisible();
  await expect(dark).toBeHidden();
  await page.locator('[data-theme-toggle]').click();
  await expect(page.locator('html')).toHaveClass(/dark-mode/);
  await expect(dark).toBeVisible();
  await expect(light).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('darkMode'))).toBe('true');
});

test('a practice map link opens a fresh copy of its map', async ({ page, context }) => {
  const [, sample, query = ''] = built(withMap.url).match(/href="\/sample\/([^"?]+)(\?lesson)?"/);
  const slices = JSON.parse(read(`public/samples/${sample}.json`)).slices.length;
  await page.goto(withMap.url);
  const [map] = await Promise.all([
    context.waitForEvent('page'),
    page.locator(`a[href="/sample/${sample}${query}"]`).first().click(),
  ]);
  await expect(map).toHaveURL(/\/[a-z0-9]{8}$/);
  await expect(map.locator('.slice-container')).toHaveCount(slices);
});
