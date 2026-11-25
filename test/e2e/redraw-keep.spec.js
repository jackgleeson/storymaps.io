import { test, expect, openMap, cardNames, addCard, acceptDialog, undo } from './fixtures.js';

// A redraw keeps the cards and steps that have not changed and draws the rest again (see
// src/ui/keep.js). The fixtures check every redraw in every test against the map built from
// nothing. These tests check that cards really are kept, and the cases keeping makes possible.

const MAP = `name: Coffee app
users:
  - name: Customer
steps:
  - Browse
  - Order
slices:
  - name: MVP
    stories:
      Browse:
        - name: One
        - name: Two
      Order:
        - name: Pick size
  - name: Later
    stories:
      Browse:
        - name: Offers
`;

// Tall enough that a card menu opens whole, with its Delete in reach
test.use({ viewport: { width: 1280, height: 1000 } });

const deleteFromMenu = async (page, card) => {
  await card.hover();
  await card.locator('.btn-options').click();
  const menu = page.locator('.options-menu.visible');
  await expect(menu).toBeVisible();
  await menu.locator('.options-delete').click();
};

// Mark every card and step on the page, then say which titles are still on a marked element
const mark = (page) => page.evaluate(() => document.querySelectorAll('#storyMap .story-card, #storyMap .step').forEach(c => { c.__seen = true; }));
const titles = (page, seen) => page.evaluate((seen) => [...document.querySelectorAll('#storyMap .story-card, #storyMap .step')]
  .filter(c => !!c.__seen === seen).map(c => c.querySelector('textarea').value).sort(), seen);

test('adding a card keeps every other card and step on the page', async ({ page, createMap }) => {
  await openMap(page, await createMap(MAP), 2);
  await mark(page);
  await addCard(page, 'Three');
  expect(await titles(page, true)).toEqual(['Browse', 'Customer', 'Offers', 'One', 'Order', 'Pick size', 'Two']);
  expect(await titles(page, false)).toEqual(['Three']);
});

test('with the redraw set to full in this browser, every card is drawn again', async ({ page, createMap }) => {
  await openMap(page, await createMap(MAP), 2);
  await page.evaluate(() => localStorage.setItem('redraw', 'full'));
  await mark(page);
  await addCard(page, 'Three');
  expect(await titles(page, true)).toEqual([]);
});

test('a title changed by someone else redraws that card alone, and typing elsewhere carries on', async ({ page, createMap, openSecondTab, pullMap }) => {
  const id = await createMap(MAP);
  const other = await openSecondTab();
  await openMap(page, id, 2);
  await openMap(other, id, 2);

  // This person is part way through a title
  const mine = page.locator('.slice-container').first().locator('.story-card textarea').first();
  await mine.click();
  await mine.press('End');
  await page.keyboard.type(' and');
  await mark(page);

  // The other person renames another card
  const theirs = other.locator('.slice-container').nth(1).locator('.story-card textarea').first();
  await theirs.fill('Offers of the week');
  await expect.poll(() => cardNames(page, 0)).toEqual(['One and', 'Two']);
  await expect(page.locator('.slice-container').nth(1).locator('.story-card textarea').first()).toHaveValue('Offers of the week');

  expect(await titles(page, false)).toEqual(['Offers of the week']);
  // The cursor is still in the same box, in the same place, with no redraw of that card
  await expect(mine).toBeFocused();
  expect(await mine.evaluate(t => [t.selectionStart, t.selectionEnd, !!t.closest('.story-card').__seen])).toEqual([7, 7, true]);
  await page.keyboard.type(' more');
  await expect(mine).toHaveValue('One and more');
  await expect.poll(async () => (await pullMap(id)).slices[0].stories[0][0].name).toBe('One and more');
});

test('a card that moves to another step is drawn again, and deleting it removes the right card', async ({ page, createMap, pullMap }) => {
  const id = await createMap(MAP);
  await openMap(page, id, 2);
  await mark(page);
  const cells = page.locator('.slice-container').first().locator('.story-column');
  const from = await cells.nth(0).locator('.story-card').nth(1).boundingBox();
  const to = await cells.nth(1).locator('.story-card').first().boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + 6);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 4, from.y + 12, { steps: 4 });
  await page.waitForTimeout(120);
  await page.mouse.move(to.x + to.width / 2, to.y + to.height * 0.75, { steps: 24 });
  await page.waitForTimeout(300);
  await page.mouse.up();
  await expect.poll(() => cardNames(page, 1)).toEqual(['Pick size', 'Two']);
  expect(await titles(page, false)).toEqual(['Two']);

  // The moved card knows its new step: deleting it takes it from there
  const moved = cells.nth(1).locator('.story-card').nth(1);
  await deleteFromMenu(page, moved);
  expect(await acceptDialog(page)).toBe('Delete "Two"?');
  await expect.poll(() => cardNames(page, 1)).toEqual(['Pick size']);
  await expect.poll(async () => (await pullMap(id)).slices[0].stories.map(cards => cards.map(c => c.name))).toEqual([['One'], ['Pick size']]);
});

test('the question before a delete uses the title as it is now, on a card that was kept', async ({ page, createMap }) => {
  await openMap(page, await createMap(MAP), 2);
  const card = page.locator('.slice-container').first().locator('.story-card').first();
  await card.locator('textarea').fill('Renamed');
  // Another change redraws the map and keeps this card
  await addCard(page, 'Three');
  await deleteFromMenu(page, card);
  expect(await acceptDialog(page)).toBe('Delete "Renamed"?');
});

test('a users cell that loses its only card takes a new one with a click', async ({ page, createMap }) => {
  await openMap(page, await createMap(MAP), 2);
  const users = page.locator('.users-row');
  const cell = users.locator('.story-column').first();
  await mark(page);

  const card = cell.locator('.story-card');
  await deleteFromMenu(page, card);
  await acceptDialog(page);
  await expect(users.locator('.story-card')).toHaveCount(0);

  // The row has no cards now, and its cells are the ones that were there before
  await page.locator('.users-row .story-column').first().click();
  await expect(page.locator('.users-row .story-card')).toHaveCount(1);
  // A second click on the cell does not add another: it is no longer empty
  await page.locator('.users-row .story-card textarea').fill('Barista');
  await page.locator('.users-row .story-column').first().click({ position: { x: 3, y: 3 } });
  await expect(page.locator('.users-row .story-card')).toHaveCount(1);
});

test('a colour changed on a card keeps the card through the next redraw', async ({ page, createMap }) => {
  await openMap(page, await createMap(MAP), 2);
  const card = page.locator('.slice-container').first().locator('.story-card').first();
  await card.hover();
  await card.locator('.btn-options').click();
  await card.locator('.color-swatch').nth(2).click();
  await page.keyboard.press('Escape');
  await mark(page);
  await addCard(page, 'Three');
  expect(await titles(page, false)).toEqual(['Three']);
});

test('undo redraws only the card it changes', async ({ page, createMap }) => {
  await openMap(page, await createMap(MAP), 2);
  const first = page.locator('.slice-container').first().locator('.story-card textarea').first();
  await first.click();
  await first.fill('Changed');
  await mark(page);

  await undo(page);
  await expect.poll(() => cardNames(page, 0)).toEqual(['One', 'Two']);
  expect(await titles(page, false)).toEqual(['One']);
  expect(await titles(page, true)).toEqual(['Browse', 'Customer', 'Offers', 'Order', 'Pick size', 'Two']);

  // The undone card is the one on the map: typing in it is saved
  await first.fill('One again');
  await addCard(page, 'Three');
  await expect.poll(() => cardNames(page, 0)).toEqual(['One again', 'Two', 'Three']);
});

test('a search stays applied when someone else changes the map', async ({ page, createMap, openSecondTab }) => {
  const id = await createMap(MAP);
  const other = await openSecondTab();
  await openMap(page, id, 2);
  await openMap(other, id, 2);

  await page.getByRole('button', { name: 'Search' }).click();
  await page.locator('#searchInput').fill('one');
  const dimmed = () => page.evaluate(() => [...document.querySelectorAll('#storyMap .story-card.search-dimmed textarea')].map(t => t.value).sort());
  await expect.poll(dimmed).toEqual(['Customer', 'Offers', 'Pick size', 'Two']);

  // Someone else adds a card that does not match, and renames one so it no longer matches
  await addCard(other, 'Three');
  await other.locator('.slice-container').first().locator('.story-card textarea').first().fill('First');
  await expect.poll(() => cardNames(page, 0)).toEqual(['First', 'Two', 'Three']);
  await expect.poll(dimmed).toEqual(['Customer', 'First', 'Offers', 'Pick size', 'Three', 'Two']);
});

// Two people: one is part way through a drag when a change from the other arrives
for (const redraw of ['keep', 'full']) {
  test(`a card dragged while someone else adds a card lands where it was dropped (redraw: ${redraw})`, async ({ page, createMap, openSecondTab, pullMap }) => {
    const id = await createMap(MAP);
    const other = await openSecondTab();
    await openMap(page, id, 2);
    await openMap(other, id, 2);
    await page.evaluate((redraw) => localStorage.setItem('redraw', redraw), redraw);

    const cells = page.locator('.slice-container').first().locator('.story-column');
    const from = await cells.nth(0).locator('.story-card').nth(1).boundingBox();
    const to = await cells.nth(1).locator('.story-card').first().boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + 6);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 4, from.y + 12, { steps: 4 });
    await page.waitForTimeout(120);
    await page.mouse.move(to.x + to.width / 2, to.y + to.height * 0.75, { steps: 24 });
    await page.waitForTimeout(200);
    await expect(page.locator('.sortable-drag')).toHaveCount(1);

    // The other person adds a card to the second slice while the card is in the air
    await other.locator('.slice-container').nth(1).locator('.story-column').first().locator('.btn-add-story').click();
    await other.keyboard.type('Added meanwhile');
    await other.keyboard.press('Escape');
    await expect.poll(async () => (await pullMap(id)).slices[1].stories[0].map(c => c.name)).toEqual(['Offers', 'Added meanwhile']);
    await page.waitForTimeout(400);

    // The drag carries on and the card is dropped
    await page.mouse.move(to.x + to.width / 2 + 2, to.y + to.height * 0.75 + 2, { steps: 3 });
    await page.mouse.up();

    const shown = (p) => p.evaluate(() => [...document.querySelectorAll('.slice-container')].map(s =>
      [...s.querySelectorAll('.story-column:not(.phantom-column)')].map(c => [...c.querySelectorAll('.story-card textarea')].map(t => t.value))));
    const expected = [[['One'], ['Pick size', 'Two']], [['Offers', 'Added meanwhile'], []]];
    await expect.poll(() => shown(page)).toEqual(expected);
    await expect.poll(() => shown(other)).toEqual(expected);
    await expect(page.locator('.sortable-drag, .sortable-ghost, .sortable-chosen')).toHaveCount(0);
    await expect.poll(async () => (await pullMap(id)).slices.map(s => s.stories.map(cards => cards.map(c => c.name)))).toEqual(expected);
  });
}

test('a slice someone else adds while a slice is being dragged is kept after the drop', async ({ page, createMap, openSecondTab, pullMap }) => {
  const id = await createMap(MAP);
  const other = await openSecondTab();
  await openMap(page, id, 2);
  await openMap(other, id, 2);
  const sliceNames = async () => (await pullMap(id)).slices.map(s => s.name);

  // Pick up the first slice by its handle and carry it below the second
  const handle = page.locator('.slice-container').first().locator('.slice-drag-handle');
  await page.locator('.slice-container').first().locator('.slice-label-container').hover();
  const from = await handle.boundingBox();
  const second = await page.locator('.slice-container').nth(1).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + 20, { steps: 5 });
  await page.mouse.move(from.x + from.width / 2, second.y + second.height - 10, { steps: 20 });
  await page.waitForTimeout(200);

  // The other person adds a slice while it is in the air
  await other.locator('.slice-container').nth(1).locator('.slice-label-container').hover();
  await other.locator('.slice-container').nth(1).locator('.btn-add-slice').click();
  await other.keyboard.type('Added meanwhile');
  await other.keyboard.press('Enter');
  await expect.poll(sliceNames).toEqual(['MVP', 'Later', 'Added meanwhile']);
  await page.waitForTimeout(300);

  await page.mouse.up();
  // The dragged slice moved, and the new one is still there, for both people and on the server
  await expect.poll(sliceNames).toEqual(['Later', 'MVP', 'Added meanwhile']);
  const shown = (p) => p.locator('.slice-container .slice-label').allInnerTexts();
  await expect.poll(() => shown(page)).toEqual(['Later', 'MVP', 'Added meanwhile']);
  await expect.poll(() => shown(other)).toEqual(['Later', 'MVP', 'Added meanwhile']);
});

// A big story map gets the drag changes. The redraw that keeps what has not changed is for every story map.
const mapOf = (cards) => `name: Sized
steps:
  - Browse
slices:
  - name: MVP
    stories:
      Browse:
${Array.from({ length: cards }, (_, i) => `        - name: Card ${i + 1}`).join('\n')}
`;

test('a story map of 300 cards counts as big, and one of 299 does not', async ({ page, createMap }) => {
  await openMap(page, await createMap(mapOf(299)), 1);
  await expect(page.locator('.slice-container .story-card')).toHaveCount(299);
  await expect(page.locator('#storyMap')).not.toHaveClass(/big-map/);

  await openMap(page, await createMap(mapOf(300)), 1);
  await expect(page.locator('.slice-container .story-card')).toHaveCount(300);
  await expect(page.locator('#storyMap')).toHaveClass(/big-map/);
});
