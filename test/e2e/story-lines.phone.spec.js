import { test, expect, openMap } from './fixtures.js';

test('the story chips fit the expanded card on a phone and add lines when tapped', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  await page.locator('.slice-container .story-card').first().locator('.btn-expand').tap();
  const chips = page.locator('#cardExpandChips');
  await expect(chips).toBeVisible();

  const modal = await page.locator('.card-expand-modal').boundingBox();
  for (const box of await chips.getByRole('button').evaluateAll(els => els.map(e => e.getBoundingClientRect().toJSON()))) {
    expect(box.x).toBeGreaterThanOrEqual(modal.x);
    expect(box.x + box.width).toBeLessThanOrEqual(modal.x + modal.width);
    expect(box.height).toBeGreaterThanOrEqual(28);
  }

  await chips.getByRole('button', { name: 'Given, When, Then' }).tap();
  await expect(page.locator('#cardExpandBody')).toHaveValue('Given \nWhen \nThen ');
});
