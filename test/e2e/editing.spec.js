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

test('colour swatches show the first letter of the legend name for their colour', async ({ page }) => {
  await page.goto('/new');
  const card = page.locator('.slice-container .story-card').first();
  let menu = await openOptions(page, card);
  await expect(menu.locator('.color-swatch[title="Questions (lime)"]')).toHaveText('Q');
  await expect(menu.locator('.color-swatch[title="Tasks (yellow)"]')).toHaveText('T');
  await expect(menu.locator('.color-swatch[title="Edge cases (rose)"]')).toHaveText('E');
  // A colour with no legend entry stays plain
  await expect(menu.locator('.color-swatch[title="red"]')).toHaveText('');
  await page.mouse.click(5, 790);

  // Renaming the legend entry changes the letter
  if (!(await page.locator('#legendPanel').isVisible())) await page.locator('#legendToggle').click();
  const label = page.locator('.legend-label').nth(2);
  await label.fill('Risks');
  await label.press('Enter');
  menu = await openOptions(page, card);
  await expect(menu.locator('.color-swatch[title="Risks (lime)"]')).toHaveText('R');
  await page.mouse.click(5, 790);

  // The bulk colour panel shows the letters too
  const box = await card.boundingBox();
  await card.click({ position: { x: box.width / 2, y: box.height - 4 } });
  await page.locator('.selection-toolbar-color').click();
  await expect(page.locator('.selection-toolbar-color-swatch[title="Risks (lime)"]')).toHaveText('R');
  await page.keyboard.press('Escape');

  // So do the expanded card and the legend's own colour picker
  await card.hover();
  await card.locator('.btn-expand').click();
  const expanded = page.locator('.card-expand-swatch[title="Risks (lime)"]');
  if (!(await expanded.isVisible())) await page.locator('.card-expand-summary').click();
  await expect(expanded).toHaveText('R');
  await expect(expanded).toHaveAttribute('aria-label', 'Risks (lime)');
  await page.keyboard.press('Escape');
  await page.locator('.legend-swatch').first().click();
  await expect(page.locator('.legend-color-picker .color-swatch[title="Risks (lime)"]')).toHaveText('R');
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

test('clicking into a card that still has its starter text selects it, so typing replaces it', async ({ page }) => {
  await page.goto('/new');
  const activity = page.locator('.activities-row .story-card textarea').first();
  await expect(activity).toHaveValue('New Activity');
  // Click by position, partway into the text, as a person would
  const box = await activity.boundingBox();
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
  await page.keyboard.type('Order Coffee');
  await expect(activity).toHaveValue('Order Coffee');
  // Once renamed, a click places the cursor as usual
  await page.keyboard.press('Tab');
  await page.mouse.click(box.x + 4, box.y + box.height / 2);
  await page.keyboard.type('!');
  await expect(activity).not.toHaveValue('!');
});

test('dragging a card selects no text in the cards it passes over', async ({ page, createMap }) => {
  const id = await createMap(`name: Drag
steps:
  - A
  - B
slices:
  - name: MVP
    stories:
      A:
        - name: first card with some words
        - name: second card with some words
        - name: third card with some words
      B:
        - name: fourth card with some words
`);
  await openMap(page, id, 2);
  const box = await page.locator('.slice-container .story-card').first().boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  // Grab the card by its text, as people do, and carry it down and across
  // A busy machine can miss the start of a drag, so let go and try again until the card is in the air
  await expect(async () => {
    await page.mouse.up();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 40, y + 120, { steps: 15 });
    await page.mouse.move(x + 200, y + 150, { steps: 15 });
    await expect(page.locator('.sortable-drag')).toBeVisible({ timeout: 1000 });
  }).toPass();
  const selected = () => page.evaluate(() => String(window.getSelection()) +
    [...document.querySelectorAll('#storyMap textarea')].map(t => t.value.slice(t.selectionStart, t.selectionEnd)).join(''));
  expect(await selected()).toBe('');
  await page.mouse.up();
  // Text can be selected again once the card is dropped
  await expect(page.locator('body')).not.toHaveClass(/dragging-cards/);
});
