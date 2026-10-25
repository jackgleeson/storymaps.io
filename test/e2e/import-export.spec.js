import { test, expect, openMap, stepNames, cardNames, acceptDialog } from './fixtures.js';

const openSubmenu = async (page, triggerId, itemId) => {
  await page.locator('#menuBtn').click();
  await page.locator(`#${triggerId}`).click();
  await page.locator(`#${itemId}`).click();
};

test('Export as YAML shows the map', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  await openSubmenu(page, 'exportSubmenuTrigger', 'exportYamlBtn');
  const yaml = page.locator('#exportYamlText');
  await expect(yaml).toBeVisible();
  await expect(yaml).toHaveValue(/^name: Coffee app$/m);
  await expect(yaml).toHaveValue(/- Browse\n\s+- Order\n\s+- Pay/);
  await expect(yaml).toHaveValue(/name: Card payment/);
});

test('Import from YAML replaces the map and saves it', async ({ page, createMap, pullMap }) => {
  const id = await createMap();
  await openMap(page, id);
  await openSubmenu(page, 'importSubmenuTrigger', 'importYamlMenuItem');
  await page.locator('#importYamlText').fill('name: Imported\nsteps:\n  - Plan\n  - Build\nslices:\n  - name: MVP\n    stories:\n      Plan:\n        - name: Sketch\n');
  await page.locator('#importYamlBtn').click();
  await acceptDialog(page);

  await expect.poll(() => stepNames(page)).toEqual(['Plan', 'Build']);
  expect(await cardNames(page)).toEqual(['Sketch']);
  await expect.poll(async () => (await pullMap(id)).name).toBe('Imported');
});

test('Import from YAML lists validation errors without changing the map', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  await openSubmenu(page, 'importSubmenuTrigger', 'importYamlMenuItem');
  await page.locator('#importYamlText').fill('name: Broken\nsteps: []\n');
  await page.locator('#importYamlBtn').click();
  await expect(page.locator('#importYamlValidationError')).toHaveText('Missing or empty "steps" list');
  expect(await stepNames(page)).toEqual(['Browse', 'Order', 'Pay']);
});
