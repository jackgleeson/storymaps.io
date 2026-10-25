import { test, expect, openMap } from './fixtures.js';

test('the collapsed footer fits a phone and opens with a tap', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  await page.locator('.slice-container .story-card').first().locator('.btn-expand').tap();
  const summary = page.locator('#cardExpandFooter .card-expand-summary');
  await expect(summary).toBeVisible();

  const modal = await page.locator('.card-expand-modal').boundingBox();
  const box = await summary.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(modal.x);
  expect(box.x + box.width).toBeLessThanOrEqual(modal.x + modal.width);

  await summary.tap();
  await expect(page.locator('#cardExpandFooter .card-expand-fields')).toBeVisible();
  const showLess = page.locator('#cardExpandFooter').getByRole('button', { name: 'Show less' });
  expect((await showLess.boundingBox()).height).toBeGreaterThanOrEqual(28);
  await showLess.tap();
  await expect(summary).toBeVisible();
});
