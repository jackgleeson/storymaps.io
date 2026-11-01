import { test, expect, openMap, squashedSections } from './fixtures.js';

test('Build with AI shows every section in full on a phone, the prompt included', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  await page.locator('#menuBtn').tap();
  await page.locator('#buildAiBtn').tap();
  await page.locator('.build-ai-target[data-target="chatgpt"]').tap();
  expect(await squashedSections(page)).toEqual([]);
});
