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
  await page.mouse.up();

  await expect.poll(() => ids(column(slice(page, 0), 0))).toContain(firstId);
  await expect.poll(() => ids(column(slice(page, 0), 1))).toContain(secondId);
  expect(await ids(column(slice(page, 0), 2))).toEqual(untouched);
  expect(await ids(column(slice(page, 1), 0))).not.toContain(firstId);
  expect(await ids(column(slice(page, 1), 1))).not.toContain(secondId);
  await expect(page.locator('.multi-drag-following')).toHaveCount(0);
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
  await page.mouse.up();

  await expect.poll(() => ids(column(slice(page, 1), 0))).toContain(firstId);
  const left = await ids(column(slice(page, 1), 0));
  const right = await ids(column(slice(page, 1), 1));
  expect(right).toContain(secondId);
  expect(left.indexOf(firstId)).toBeGreaterThan(0);
  expect(right.indexOf(secondId)).toBe(left.indexOf(firstId));
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
