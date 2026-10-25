import { test, expect, openMap } from './fixtures.js';

test('the expanded card title is one line high, and grows when the title wraps', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  const card = page.locator('.slice-container .story-card').first();
  await card.hover();
  await card.locator('.btn-expand').click();
  const title = page.locator('#cardExpandName');
  await expect(title).toBeVisible();

  const lineHeight = await title.evaluate(t => parseFloat(getComputedStyle(t).lineHeight));
  await expect.poll(() => title.evaluate(t => t.offsetHeight)).toBeLessThan(lineHeight * 1.5);

  await title.fill('A long card title that keeps going until it has to wrap onto a second line of the expanded card');
  await expect.poll(() => title.evaluate(t => t.offsetHeight)).toBeGreaterThan(lineHeight * 1.5);
});
