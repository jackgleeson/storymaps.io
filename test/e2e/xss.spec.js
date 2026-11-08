import { test, expect, openMap, openMenu } from './fixtures.js';
import { smallMap } from '../fixtures.js';

// Anyone with the link to a map can change what is in it, so text from a map must show as text
// wherever it appears, and never run in the browser of someone else who opens the map
const PAYLOAD = '<img src=x onerror="window.__xss = true">';

test('a partial map name with HTML in it shows as text in the right-click menu', async ({ page, request }) => {
  const map = { ...smallMap(), partialMaps: [{ id: 'pm000001', name: PAYLOAD, users: [[]], activities: [[]], steps: [{ name: 'Pay' }], stories: [[[]]] }] };
  const res = await request.post('/api/maps', { data: map });
  expect(res.status()).toBe(201);
  await openMap(page, (await res.json()).id, 2);

  await page.locator('.story-column').first().click({ button: 'right', position: { x: 5, y: 5 } });
  const menu = page.locator('.canvas-context-menu').first();
  await expect(menu).toBeVisible();
  await expect(page.locator('.ctx-submenu button span')).toHaveText(`${PAYLOAD} (1 step)`);
  await expect(page.locator('.canvas-context-menu img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test('a card count with HTML in it is not written into the backups list', async ({ page, createMap }) => {
  const id = await createMap();
  await page.route(`**/api/backups/${id}`, (route) => route.fulfill({
    json: [{ id: 'aaaaaaaaaaaa', timestamp: '2026-01-01T00:00:00Z', note: PAYLOAD, mapName: PAYLOAD, size: 10, cardCount: PAYLOAD, imported: true }],
  }));
  await openMap(page, id);
  await openMenu(page, 'backupsBtn');
  await expect(page.locator('#backupsList .backup-row')).toHaveCount(1);
  await expect(page.locator('#backupsList img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});
