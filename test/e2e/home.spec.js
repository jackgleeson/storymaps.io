import fs from 'node:fs';
import { test, expect } from './fixtures.js';

const about = (page) => page.locator('.welcome-about');

test('the home page says what the tool does below the welcome area', async ({ page }) => {
  await page.goto('/');
  await expect(about(page).locator('h2')).toHaveText('A user story mapping tool for the whole team');
  await expect(about(page).locator('.welcome-about-row h3')).toHaveText([
    'Lay out users, activities and steps',
    'Slice out releases your team can ship',
    'The big picture on the story map, the detail in the card',
    'Import a backlog, export a plan',
  ]);
  await expect(about(page).locator('.welcome-about-tool')).toHaveText(['Jira', 'Linear', 'Asana', 'Azure DevOps', 'Phabricator']);
  await expect(about(page).locator('.welcome-about-faq h3')).toHaveCount(3);

  // One screenshot per row shows, and it loads
  for (const shot of await about(page).locator('.welcome-about-shot img:visible').all()) {
    await shot.scrollIntoViewIfNeeded();
    await expect.poll(() => shot.evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  }
  await expect(about(page).locator('.welcome-about-shot img:visible')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('the text is in the page as served, and its links lead to pages that exist', async ({ page, request }) => {
  const html = await (await request.get('/')).text();
  expect(html).toContain('A user story mapping tool for the whole team');
  expect(html).toContain('Is Storymaps.io free?');
  for (const src of html.match(/\/docs\/img\/[\w-]+\.png/g)) {
    expect(fs.existsSync(`public${src}`), src).toBe(true);
  }

  await page.goto('/');
  const links = await about(page).locator('.welcome-about-next a').evaluateAll(as => as.map(a => a.getAttribute('href')));
  expect(links).toEqual(['/docs/what-is-a-user-story-map', '/docs/create-a-user-story-map']);
  for (const href of links) expect((await request.get(href)).status(), href).toBe(200);
});

test('links in the text lead to guides, and the questions are also in the structured data', async ({ page, request }) => {
  await page.goto('/');
  const hrefs = await about(page).locator('.welcome-about-row a').evaluateAll(as => as.map(a => a.getAttribute('href')));
  expect(hrefs).toHaveLength(9);
  for (const href of hrefs) expect((await request.get(href)).status(), href).toBe(200);

  const shown = await about(page).locator('.welcome-about-faq > div').evaluateAll(rows => rows.map(r => [r.querySelector('h3').textContent, r.querySelector('p').textContent]));
  const data = JSON.parse(await page.locator('#faqData').textContent());
  expect(data.mainEntity.map(q => [q.name, q.acceptedAnswer.text])).toEqual(shown);
});

test('the sample named in the text opens that sample', async ({ page }) => {
  await page.goto('/');
  await about(page).locator('.welcome-about-sample').click();
  await expect(page.locator('#boardName')).toHaveValue('Coffee Ordering App');
});
