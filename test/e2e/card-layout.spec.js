import { test, expect, openMap } from './fixtures.js';

// The card sizes are measured after a render, for every card in one go (queueLayoutJob in
// src/ui/ui.js). These check what the measuring decides.
const MAP = `name: Recipes
steps:
  - Browse
slices:
  - name: MVP
    stories:
      Browse:
        - name: Search
        - name: Search by ingredient, by cuisine and by how long the cooking takes
        - name: Tagged
          tags: [frontend]
        - name: Long tag
          tags: [a-very-long-tag-that-cannot-fit-on-one-card]
`;

const card = (page, index) => page.locator('.slice-container .story-card').nth(index);

test('a short title takes one row and a long one takes two', async ({ page, createMap }) => {
  await openMap(page, await createMap(MAP), 1);
  await expect(card(page, 0).locator('.story-text')).toHaveJSProperty('rows', 1);
  await expect(card(page, 1).locator('.story-text')).toHaveJSProperty('rows', 2);
});

test('a tag too long for the card opens a list of the tags, and a tag that fits does not', async ({ page, createMap }) => {
  await openMap(page, await createMap(MAP), 1);
  await expect(card(page, 3).locator('.card-tags-popover')).toHaveCount(1);
  await expect(card(page, 2).locator('.card-tags-popover')).toHaveCount(0);
  await card(page, 3).locator('.card-tag-badge').click();
  await expect(card(page, 3).locator('.card-tags-popover')).toBeVisible();
  await expect(card(page, 3).locator('.card-tags-popover-pill')).toHaveText('a-very-long-tag-that-cannot-fit-on-one-card');
});
