import { createHash } from 'node:crypto';
import { test, expect, openMap } from './fixtures.js';

// A locked map checks its lock every few seconds. Typing in boxes that don't edit the map, such as
// search or the project name, must keep focus through those checks.
test('on a locked map, search and the project name keep focus while typing', async ({ page, createMap, request }) => {
  const id = await createMap();
  const passwordHash = createHash('sha256').update('secret').digest('hex');
  expect((await request.post(`/api/lock/${id}`, { data: { passwordHash } })).status()).toBe(200);
  await openMap(page, id);
  await expect(page.locator('#readOnlyBanner')).toBeVisible();

  const typeSlowly = async (input, text) => {
    await input.click();
    for (const ch of text) {
      await page.keyboard.type(ch);
      await page.waitForTimeout(500);
    }
  };

  await page.locator('#projectAddBtn').click();
  const name = page.locator('#projectStartName');
  await typeSlowly(name, 'Coffee App');
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('Coffee App');
  await page.keyboard.press('Escape');

  await page.locator('#searchBtn').click();
  const search = page.locator('#searchInput');
  await typeSlowly(search, 'Card pay');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('Card pay');
});
