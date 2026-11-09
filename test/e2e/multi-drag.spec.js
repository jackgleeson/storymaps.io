import { test, expect } from './fixtures.js';

const slice = (page, i) => page.locator('.slice-container').nth(i);
const column = (scope, i) => scope.locator('.story-column').nth(i);
const ids = (scope) => scope.locator('.story-card[data-story-id]').evaluateAll(cards => cards.map(c => c.dataset.storyId));

const select = async (card, modifiers = []) => {
  const box = await card.boundingBox();
  await card.click({ position: { x: box.width / 2, y: box.height - 4 }, modifiers });
};

const openWithTwoSelected = async (page, secondColumn, secondRow = 0) => {
  await page.goto('/sample/coffee-ordering');
  await expect(slice(page, 1).locator('.story-card').first()).toBeVisible();
  const first = column(slice(page, 1), 0).locator('.story-card[data-story-id]').first();
  const second = column(slice(page, 1), secondColumn).locator('.story-card[data-story-id]').nth(secondRow);
  await select(first);
  await select(second, ['Shift']);
  await expect(page.locator('.story-card.card-selected')).toHaveCount(2);
  return { first, second, firstId: await first.getAttribute('data-story-id'), secondId: await second.getAttribute('data-story-id') };
};

const centre = async (locator) => {
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test('cards selected from two columns move up to another slice, each staying in its own column', async ({ page }) => {
  const { first, second, firstId, secondId } = await openWithTwoSelected(page, 1);
  const untouched = await ids(column(slice(page, 0), 2));
  const from = await centre(first);
  const startLeft = (await first.boundingBox()).x;
  const startTop = (await first.boundingBox()).y;
  const secondStart = await second.boundingBox();
  const to = await centre(column(slice(page, 0), 0).locator('.story-card[data-story-id]').first());
  const farColumn = await centre(column(slice(page, 0), 2).locator('.story-card[data-story-id]').first());

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // The pointer drifts two columns to the right on its way up
  await page.mouse.move(farColumn.x, to.y, { steps: 20 });
  await page.waitForTimeout(250);
  const ghost = await page.locator('.sortable-drag').boundingBox();
  expect(Math.abs(ghost.x - startLeft)).toBeLessThan(3);
  // The other card travels up with it, in its own column
  const follower = await page.locator('.story-card.multi-drag-following').boundingBox();
  expect(Math.abs(follower.x - secondStart.x)).toBeLessThan(3);
  expect(Math.abs((follower.y - secondStart.y) - (ghost.y - startTop))).toBeLessThan(3);
  expect(ghost.y).toBeLessThan(startTop);
  // A pale card shows where it will land, in its own column of the slice
  await expect(column(slice(page, 0), 1).locator('.multi-drag-landing')).toHaveCount(1);
  await page.mouse.up();

  await expect.poll(() => ids(column(slice(page, 0), 0))).toContain(firstId);
  await expect.poll(() => ids(column(slice(page, 0), 1))).toContain(secondId);
  expect(await ids(column(slice(page, 0), 2))).toEqual(untouched);
  expect(await ids(column(slice(page, 1), 0))).not.toContain(firstId);
  expect(await ids(column(slice(page, 1), 1))).not.toContain(secondId);
  await expect(page.locator('.multi-drag-following')).toHaveCount(0);
  await expect(page.locator('.multi-drag-landing')).toHaveCount(0);
});

test('cards from two columns land at the same level in the slice they are dropped in', async ({ page }) => {
  await page.goto('/sample/coffee-ordering');
  await expect(slice(page, 2).locator('.story-card').first()).toBeVisible();
  const first = column(slice(page, 2), 0).locator('.story-card[data-story-id]').first();
  const second = column(slice(page, 2), 1).locator('.story-card[data-story-id]').first();
  const [firstId, secondId] = [await first.getAttribute('data-story-id'), await second.getAttribute('data-story-id')];
  await select(first);
  await select(second, ['Shift']);
  await expect(page.locator('.story-card.card-selected')).toHaveCount(2);

  const from = await centre(first);
  // The second card down in the slice above
  const target = await column(slice(page, 1), 0).locator('.story-card[data-story-id]').nth(1).boundingBox();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 3, from.y - 12, { steps: 4 });
  await page.waitForTimeout(120);
  await page.mouse.move(from.x, target.y + target.height * 0.75, { steps: 24 });
  await page.waitForTimeout(400);
  // The pale cards are level with each other, and the drop matches them
  const level = (card) => card.evaluate(c => [...c.parentElement.children].filter(o => o.matches('.story-card')).indexOf(c));
  const shown = await level(page.locator('.multi-drag-landing'));
  expect(shown).toBe(await level(page.locator('.story-card.sortable-ghost:not(.multi-drag-landing)')));
  await page.mouse.up();

  await expect.poll(() => ids(column(slice(page, 1), 0))).toContain(firstId);
  const left = await ids(column(slice(page, 1), 0));
  const right = await ids(column(slice(page, 1), 1));
  expect(right).toContain(secondId);
  expect(left.indexOf(firstId)).toBeGreaterThan(0);
  expect(right.indexOf(secondId)).toBe(left.indexOf(firstId));
  expect(right.indexOf(secondId)).toBe(shown);
});

test('a selection can be dropped lower in a slice when the dragged card has nothing below it', async ({ page }) => {
  // Big enough for the map to open at full size, so the dragged card keeps up with the mouse
  await page.setViewportSize({ width: 2400, height: 1400 });
  await page.goto('/sample/coffee-ordering');
  await expect(slice(page, 1).locator('.story-card').first()).toBeVisible();
  // In V1, the first column has three cards and the third has two
  const followerCards = column(slice(page, 1), 0).locator('.story-card[data-story-id]');
  const draggedCards = column(slice(page, 1), 2).locator('.story-card[data-story-id]');
  await expect(followerCards).toHaveCount(3);
  await expect(draggedCards).toHaveCount(2);
  const follower = await followerCards.first().getAttribute('data-story-id');
  const draggedColumn = await ids(column(slice(page, 1), 2));
  await select(followerCards.first());
  await select(draggedCards.nth(1), ['Shift']);
  await expect(page.locator('.story-card.card-selected')).toHaveCount(2);

  const from = await centre(draggedCards.nth(1));
  const top = await followerCards.nth(0).boundingBox();
  const bottom = await followerCards.nth(2).boundingBox();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 2, from.y + 10, { steps: 4 });
  await page.waitForTimeout(120);
  // Far enough down that the first column's card passes the last card in its column
  await page.mouse.move(from.x, from.y + bottom.y - top.y + 12, { steps: 24 });
  await page.waitForTimeout(400);
  await page.mouse.up();

  await expect.poll(async () => (await ids(column(slice(page, 1), 0))).at(-1)).toBe(follower);
  expect(await ids(column(slice(page, 1), 2))).toEqual(draggedColumn);
});

test('a selection dropped low in a slice where the dragged card\'s column is empty lands at that level', async ({ page }) => {
  // Big enough for the map to open at full size, so the dragged card keeps up with the mouse
  await page.setViewportSize({ width: 2400, height: 1400 });
  await page.goto('/sample/coffee-ordering');
  await expect(slice(page, 1).locator('.story-card').first()).toBeVisible();
  // In the MVP the fifth and sixth columns have a card each. In V1 the fifth is empty and the sixth has two.
  const dragged = column(slice(page, 0), 4).locator('.story-card[data-story-id]').first();
  const other = column(slice(page, 0), 5).locator('.story-card[data-story-id]').first();
  const below = column(slice(page, 1), 5).locator('.story-card[data-story-id]');
  await expect(column(slice(page, 1), 4).locator('.story-card[data-story-id]')).toHaveCount(0);
  await expect(below).toHaveCount(2);
  const [draggedId, otherId] = [await dragged.getAttribute('data-story-id'), await other.getAttribute('data-story-id')];
  await select(other);
  await select(dragged, ['Shift']);
  await expect(page.locator('.story-card.card-selected')).toHaveCount(2);

  const from = await centre(dragged);
  const start = await other.boundingBox();
  const last = await below.nth(1).boundingBox();
  // Far enough for the other card to pass the last one in its column
  const distance = last.y + last.height * 0.8 - (start.y + start.height / 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 2, from.y + 12, { steps: 4 });
  await page.waitForTimeout(120);
  await page.mouse.move(from.x, from.y + distance, { steps: 26 });
  await page.waitForTimeout(500);
  await page.mouse.up();

  await expect.poll(() => ids(column(slice(page, 1), 4))).toEqual([draggedId]);
  expect((await ids(column(slice(page, 1), 5))).at(-1)).toBe(otherId);
  expect(await ids(column(slice(page, 0), 4))).not.toContain(draggedId);
});

test('cards selected from one column can still be dragged sideways together', async ({ page }) => {
  await page.goto('/sample/coffee-ordering');
  await expect(slice(page, 1).locator('.story-card').first()).toBeVisible();
  const cards = column(slice(page, 1), 0).locator('.story-card[data-story-id]');
  await expect.poll(() => cards.count()).toBeGreaterThan(1);
  const [a, b] = await ids(column(slice(page, 1), 0));
  await select(cards.nth(0));
  await select(cards.nth(1), ['Shift']);
  await expect(page.locator('.story-card.card-selected')).toHaveCount(2);
  const from = await centre(cards.nth(0));
  const target = await column(slice(page, 1), 1).locator('.story-card[data-story-id]').first().boundingBox();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 2, { steps: 4 });
  await page.waitForTimeout(120);
  // The lower part of the card, which drops below it
  await page.mouse.move(target.x + target.width / 2, target.y + target.height * 0.75, { steps: 20 });
  await page.waitForTimeout(400);
  await page.mouse.up();
  await expect.poll(() => ids(column(slice(page, 1), 1))).toEqual(expect.arrayContaining([a, b]));
});
