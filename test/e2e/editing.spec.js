import { test, expect, openMap, stepNames, cardNames, acceptDialog, undo, openMenu } from './fixtures.js';

const openOptions = async (page, card) => {
  await card.hover();
  await card.locator('.btn-options').click();
  const menu = page.locator('.options-menu.visible');
  await expect(menu).toBeVisible();
  return menu;
};

test('a step menu offers Delete Column, not Delete; a card menu offers Delete', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  const stepMenu = await openOptions(page, page.locator('.step').first());
  await expect(stepMenu.locator('.options-delete-column')).toHaveText('Delete Column');
  await expect(stepMenu.locator('.options-delete')).toHaveCount(0);
  await page.mouse.click(5, 790);

  const cardMenu = await openOptions(page, page.locator('.slice-container .story-card').first());
  await expect(cardMenu.locator('.options-delete')).toHaveText('Delete');
});

test('Delete Column asks first, removes the step and its cards, and undo brings them back', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  const menu = await openOptions(page, page.locator('.step').first());
  await menu.locator('.options-delete-column').click();
  expect(await acceptDialog(page)).toBe('Delete this column and all its stories?');
  await expect.poll(() => stepNames(page)).toEqual(['Order', 'Pay']);
  expect(await cardNames(page)).toEqual(['Pick size']);

  await undo(page);
  await expect.poll(() => stepNames(page)).toEqual(['Browse', 'Order', 'Pay']);
  expect(await cardNames(page)).toEqual(['One', 'Two', 'Three']);
});

test('Delete Card with a story and a step selected deletes only the story', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  const card = page.locator('.slice-container .story-card').first();
  const box = await card.boundingBox();
  await card.click({ position: { x: box.width / 2, y: box.height - 4 } });
  await page.locator('.step').nth(2).click({ position: { x: 6, y: 6 }, modifiers: ['Shift'] });
  await page.locator('.selection-toolbar-delete').click();
  expect(await acceptDialog(page)).toBe('Delete 1 card?');
  await expect.poll(() => cardNames(page)).toEqual(['Two', 'Three']);
  expect(await stepNames(page)).toEqual(['Browse', 'Order', 'Pay']);
  await expect(page.locator('.step-placeholder:not(.phantom-step)')).toHaveCount(0);
});

test('0 story points are saved', async ({ page, createMap, pullMap }) => {
  const id = await createMap();
  await openMap(page, id);
  const menu = await openOptions(page, page.locator('.slice-container .story-card').first());
  await menu.locator('.points-input').fill('0');
  await page.mouse.click(5, 790);
  await expect.poll(async () => (await pullMap(id)).slices[0].stories[0][0].points).toBe(0);
});

test('pressing Enter in the points box saves the points', async ({ page, createMap, pullMap }) => {
  const id = await createMap();
  await openMap(page, id);
  const menu = await openOptions(page, page.locator('.slice-container .story-card').first());
  await menu.locator('.points-input').fill('5');
  await menu.locator('.points-input').press('Enter');
  await expect.poll(async () => (await pullMap(id)).slices[0].stories[0][0].points).toBe(5);
});

test('undo does nothing on a new map, even after editing another one', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  const menu = await openOptions(page, page.locator('.step').first());
  await menu.locator('.color-swatch').nth(2).click();

  await openMenu(page, 'newMapBtn');
  await acceptDialog(page);
  await expect(page).not.toHaveURL(/Coffee/);
  await expect.poll(() => stepNames(page)).toEqual(['New Step']);

  await undo(page);
  await page.waitForTimeout(300);
  expect(await stepNames(page)).toEqual(['New Step']);
  await expect(page.locator('#boardName')).toHaveValue('');
});
