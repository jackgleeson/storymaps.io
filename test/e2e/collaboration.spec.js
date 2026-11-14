import { test, expect, openMap, cardNames, addCard, acceptDialog } from './fixtures.js';

test('a card added by one person appears for the other', async ({ page, createMap, openSecondTab }) => {
  const id = await createMap();
  const other = await openSecondTab();
  await openMap(page, id);
  await openMap(other, id);

  await addCard(page, 'Live card');
  await expect.poll(() => cardNames(other)).toEqual(['One', 'Two', 'Three', 'Live card']);
});

test('cards added while one person is offline merge without duplicates', async ({ page, createMap, openSecondTab }) => {
  const id = await createMap();
  const other = await openSecondTab();
  await openMap(page, id);
  await openMap(other, id);

  await other.context().setOffline(true);
  await addCard(page, 'From A');
  await addCard(other, 'From B');
  await other.context().setOffline(false);

  // Each card once, in the same order for both people
  const sorted = async (p) => [...await cardNames(p)].sort();
  await expect.poll(() => sorted(page), { timeout: 15_000 }).toEqual(['From A', 'From B', 'One', 'Three', 'Two']);
  await expect.poll(() => sorted(other), { timeout: 15_000 }).toEqual(['From A', 'From B', 'One', 'Three', 'Two']);
  expect(await cardNames(other)).toEqual(await cardNames(page));
});

test('dragging a card reorders it for both people', async ({ page, createMap, openSecondTab }) => {
  const id = await createMap();
  const other = await openSecondTab();
  await openMap(page, id);
  await openMap(other, id);

  const cards = page.locator('.slice-container').first().locator('.story-column').first().locator('.story-card');
  const from = await cards.nth(2).boundingBox();
  const to = await cards.nth(0).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + 6);
  await page.mouse.down();
  for (let step = 1; step <= 15; step++) {
    await page.mouse.move(from.x + from.width / 2, from.y + 6 + (to.y - from.y - 4) * step / 15);
  }
  await page.mouse.up();

  await expect.poll(() => cardNames(page)).toEqual(['Three', 'One', 'Two']);
  await expect.poll(() => cardNames(other)).toEqual(['Three', 'One', 'Two']);
});

test('one person with several tabs open counts once', async ({ page, createMap, openSecondTab }) => {
  const id = await createMap();
  await openMap(page, id);
  // More tabs in the same browser share its storage, so they are the same person
  const sameBrowser = await page.context().newPage();
  await openMap(sameBrowser, id);
  const live = page.locator('#viewerLive');
  await expect(page.locator('#viewerName')).toHaveText('Tester');
  await expect(live).not.toHaveClass(/visible/);

  // Someone else in another browser makes two
  const other = await openSecondTab();
  await openMap(other, id);
  await expect(live).toHaveText('2');
  await expect(other.locator('#viewerLive')).toHaveText('2');
  await expect(other.locator('#viewerLive')).toHaveAttribute('data-tooltip', 'Tester (you)\nTester');
});

const openCard = async (page, n = 0) => {
  const card = page.locator('.slice-container .story-card').nth(n);
  await card.hover();
  await card.locator('.btn-expand').click();
  await expect(page.locator('#cardExpandBody')).toBeVisible();
};
const firstCard = async (pullMap, id) => (await pullMap(id)).slices[0].stories[0][0];

test('typing in an open card still saves after someone else changes the map', async ({ page, createMap, openSecondTab, pullMap }) => {
  const id = await createMap();
  const other = await openSecondTab();
  await openMap(page, id);
  await openMap(other, id);

  await openCard(page);
  await addCard(other, 'Unrelated');
  await expect.poll(() => cardNames(page)).toContain('Unrelated');
  await page.locator('#cardExpandBody').click();
  await page.keyboard.type('Typed after the change.');
  await page.locator('#cardExpandName').click();
  await page.keyboard.type(' too');

  await expect.poll(() => firstCard(pullMap, id)).toMatchObject({ name: 'One too', body: 'Typed after the change.' });
});

test('an open card shows what someone else changes on it', async ({ page, createMap, openSecondTab, pullMap }) => {
  const id = await createMap();
  const other = await openSecondTab();
  await openMap(page, id);
  await openMap(other, id);

  await openCard(page);
  await openCard(other);
  await other.locator('#cardExpandName').click();
  await other.keyboard.type(' renamed');
  await expect(page.locator('#cardExpandName')).toHaveValue('One renamed');

  // What the first person types next goes on top of the new title, not over it
  await page.locator('#cardExpandBody').click();
  await page.keyboard.type('Details');
  await expect(other.locator('#cardExpandBody')).toHaveValue('Details');
  await expect.poll(() => firstCard(pullMap, id)).toMatchObject({ name: 'One renamed', body: 'Details' });
});

test('while one person types in the description, the other sees who and has to wait', async ({ page, createMap, openSecondTab, pullMap }) => {
  const id = await createMap();
  const other = await openSecondTab();
  await openMap(page, id);
  await openMap(other, id);

  await openCard(page);
  await openCard(other);
  const note = other.locator('#cardExpandEditing');
  await expect(note).toBeHidden();

  await page.locator('#cardExpandBody').click();
  await page.keyboard.type('From A. ');
  await expect(note).toHaveText('Tester is editing the description');
  await expect(other.locator('#cardExpandBody')).toHaveJSProperty('readOnly', true);
  await expect(other.locator('#cardExpandBody')).toHaveValue('From A. ');
  // The title is still free
  await expect(other.locator('#cardExpandName')).toHaveJSProperty('readOnly', false);

  // Leaving the description frees it
  await page.locator('#cardExpandName').click();
  await expect(note).toBeHidden();
  await other.locator('#cardExpandBody').click();
  await other.keyboard.press('End');
  await other.keyboard.type('From B.');
  await expect(page.locator('#cardExpandBody')).toHaveValue('From A. From B.');
  await expect.poll(async () => (await firstCard(pullMap, id)).body).toBe('From A. From B.');
});

test('an open card closes when someone else deletes it', async ({ page, createMap, openSecondTab }) => {
  const id = await createMap();
  const other = await openSecondTab();
  await openMap(page, id);
  await openMap(other, id);

  await openCard(page);
  const card = other.locator('.slice-container .story-card').first();
  await card.hover();
  await card.locator('.btn-options').click();
  await other.locator('.options-menu.visible .options-delete').click();
  await acceptDialog(other);
  await expect.poll(() => cardNames(other)).toEqual(['Two', 'Three']);

  await expect(page.locator('#cardExpandModal')).toBeHidden();
  await expect(page.locator('#appToast')).toHaveText('Someone else deleted this card');
});

test('a change made straight after someone else types keeps what they typed', async ({ page, createMap, openSecondTab, pullMap }) => {
  const id = await createMap();
  const other = await openSecondTab();
  await openMap(page, id);
  await openMap(other, id);

  // The second person adds a card while the first person's typing is still arriving
  await openCard(page);
  await page.locator('#cardExpandBody').click();
  await page.keyboard.type('Before. ');
  await addCard(other, 'Unrelated');
  await page.keyboard.type('After.');

  await expect.poll(async () => (await firstCard(pullMap, id)).body).toBe('Before. After.');
  await expect.poll(() => cardNames(page)).toContain('Unrelated');
});

test('two people typing card titles on the map at once both keep their text', async ({ page, createMap, openSecondTab, pullMap }) => {
  const id = await createMap();
  const other = await openSecondTab();
  await openMap(page, id);
  await openMap(other, id);
  const title = (p, n) => p.locator('.slice-container .story-card').nth(n).locator('.story-text');

  await title(page, 0).click();
  await page.keyboard.press('End');
  await title(other, 1).click();
  await other.keyboard.press('End');
  for (const letter of ' first person') {
    await page.keyboard.type(letter);
    await other.keyboard.type(letter.toUpperCase());
  }

  await expect.poll(async () => (await pullMap(id)).slices[0].stories[0].slice(0, 2).map(c => c.name))
    .toEqual(['One first person', 'Two FIRST PERSON']);
  await expect.poll(() => cardNames(page)).toEqual(['One first person', 'Two FIRST PERSON', 'Three']);
  await expect.poll(() => cardNames(other)).toEqual(['One first person', 'Two FIRST PERSON', 'Three']);
});
