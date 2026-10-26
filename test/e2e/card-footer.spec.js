import { createHash } from 'node:crypto';
import { test, expect, openMap } from './fixtures.js';

const MAP = `name: Recipes
steps:
  - Browse
slices:
  - name: MVP
    stories:
      Browse:
        - name: Search by ingredient
          status: planned
          points: 3
          tags: [frontend, backend]
          url: https://example.com/recipes/search
        - name: Category filters
`;

const footer = (page) => page.locator('#cardExpandFooter');
const summary = (page) => footer(page).locator('.card-expand-summary');
const toggle = (page) => summary(page).getByRole('button', { name: 'Edit' });

const expandCard = async (page, index) => {
  const card = page.locator('.slice-container .story-card').nth(index);
  await card.hover();
  await card.locator('.btn-expand').click();
  await expect(page.locator('#cardExpandModal')).toBeVisible();
};

test('the footer opens collapsed to one line of values, with unset ones faded', async ({ page, createMap }) => {
  await openMap(page, await createMap(MAP), 1);
  await expandCard(page, 0);
  await expect(summary(page)).toBeVisible();
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(footer(page).locator('.card-expand-fields')).toHaveCount(0);

  const items = summary(page).locator('.card-expand-summary-item');
  await expect(items).toHaveText(['Planned', '3 pts', 'frontend, backend', 'example.com']);
  await expect(items.nth(0)).not.toHaveClass(/unset/);
  await page.keyboard.press('Escape');

  await expandCard(page, 1);
  await expect(summary(page).locator('.card-expand-summary-item.unset')).toHaveCount(4);
  await expect(summary(page).getByRole('link')).toHaveCount(0);
});

test('the link on the collapsed line opens in a new tab and leaves the line collapsed', async ({ page, createMap }) => {
  await page.context().route('https://example.com/**', route => route.fulfill({ body: 'ok' }));
  await openMap(page, await createMap(MAP), 1);
  await expandCard(page, 0);
  const link = summary(page).getByRole('link', { name: 'example.com' });
  await expect(link).toHaveAttribute('href', 'https://example.com/recipes/search');
  await expect(link).toHaveAttribute('target', '_blank');

  const [tab] = await Promise.all([page.context().waitForEvent('page'), link.click()]);
  expect(tab.url()).toContain('example.com/recipes/search');
  await tab.close();
  await expect(summary(page)).toBeVisible();
  await expect(footer(page).locator('.card-expand-fields')).toHaveCount(0);
});

test('Edit opens the rows, Show less folds them into an updated line, and the next card opens collapsed', async ({ page, createMap, pullMap }) => {
  const id = await createMap(MAP);
  await openMap(page, id, 1);
  await expandCard(page, 0);

  await summary(page).click();
  await expect(footer(page).locator('.card-expand-fields')).toBeVisible();
  await expect(summary(page)).toHaveCount(0);
  await footer(page).getByRole('button', { name: 'Done' }).click();
  await footer(page).locator('.card-expand-points-input').fill('5');

  await footer(page).getByRole('button', { name: 'Show less' }).click();
  await expect(toggle(page)).toBeFocused();
  await expect(summary(page).locator('.card-expand-summary-item').nth(0)).toHaveText('Done');
  await expect(summary(page).locator('.card-expand-summary-item').nth(1)).toHaveText('5 pts');
  await expect.poll(async () => (await pullMap(id)).slices[0].stories[0][0]).toMatchObject({ status: 'done', points: 5 });

  await page.keyboard.press('Escape');
  await expandCard(page, 0);
  await expect(summary(page)).toBeVisible();
});

test('a locked map shows the set values as rows, with nothing to open', async ({ page, createMap, request }) => {
  const id = await createMap(MAP);
  const passwordHash = createHash('sha256').update('secret').digest('hex');
  expect((await request.post(`/api/lock/${id}`, { data: { passwordHash } })).status()).toBe(200);
  await openMap(page, id, 1);
  await expandCard(page, 0);
  await expect(summary(page)).toHaveCount(0);
  await expect(footer(page).locator('.card-expand-fields')).toBeVisible();
  await expect(footer(page).getByRole('button', { name: 'Show less' })).toHaveCount(0);
});
