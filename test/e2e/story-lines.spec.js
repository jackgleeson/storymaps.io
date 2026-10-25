import { createHash } from 'node:crypto';
import { test, expect, openMap } from './fixtures.js';

const MAP = `name: Recipes
steps:
  - Browse
users:
  - name: Home cook
    step: Browse
slices:
  - name: MVP
    stories:
      Browse:
        - name: Search by ingredient
        - name: Category filters
          body: Filter by cuisine
`;

const body = (page) => page.locator('#cardExpandBody');
const chip = (page, name) => page.locator('#cardExpandChips').getByRole('button', { name });

const expand = async (page, card) => {
  await card.hover();
  await card.locator('.btn-expand').click();
  await expect(page.locator('#cardExpandModal')).toBeVisible();
};
const expandSliceCard = (page, index = 0) => expand(page, page.locator('.slice-container .story-card').nth(index));

test('the chips write a user story, a scenario and a criteria list, and Enter moves through them', async ({ page, createMap, pullMap }) => {
  const id = await createMap(MAP);
  await openMap(page, id, 1);
  await expandSliceCard(page);
  await expect(page.locator('#cardExpandChips')).toBeVisible();

  await chip(page, 'As a, I want, So that').click();
  await page.keyboard.type('home cook');
  await page.keyboard.press('Enter');
  await page.keyboard.type('to search by ingredient');
  await page.keyboard.press('Enter');
  await page.keyboard.type('I can use what I have');

  await chip(page, 'Given, When, Then').click();
  await page.keyboard.type('chicken and rice');
  await page.keyboard.press('Enter');
  await page.keyboard.type('I search');
  await page.keyboard.press('Enter');
  await page.keyboard.type('I see recipes with both');

  await chip(page, 'Acceptance criteria').click();
  await page.keyboard.type('Shows matches first');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Says when nothing matches');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');

  const expected = 'As a home cook\nI want to search by ingredient\nSo that I can use what I have\n\n'
    + 'Given chicken and rice\nWhen I search\nThen I see recipes with both\n\n'
    + 'Acceptance criteria\n- Shows matches first\n- Says when nothing matches\n';
  await expect(body(page)).toHaveValue(expected);

  await page.keyboard.press('Escape');
  await expect.poll(async () => (await pullMap(id)).slices[0].stories[0][0].body).toBe(expected);
});

test('a chip adds its lines below the line the cursor is on, and undo takes them back', async ({ page, createMap }) => {
  await openMap(page, await createMap(MAP), 1);
  await expandSliceCard(page, 1);
  await body(page).click();
  await page.keyboard.press('Home');
  await chip(page, 'Given, When, Then').click();
  await expect(body(page)).toHaveValue('Filter by cuisine\n\nGiven \nWhen \nThen ');
  expect(await body(page).evaluate(el => el.selectionStart)).toBe('Filter by cuisine\n\nGiven '.length);

  await page.keyboard.press('Control+z');
  await expect(body(page)).toHaveValue('Filter by cuisine');
});

test('user cards and locked maps have no chips', async ({ page, createMap, request }) => {
  const id = await createMap(MAP);
  await openMap(page, id, 1);
  await expand(page, page.locator('.story-card[data-row-type]').first());
  await expect(page.locator('#cardExpandChips')).toBeHidden();
  await page.keyboard.press('Escape');

  const passwordHash = createHash('sha256').update('secret').digest('hex');
  expect((await request.post(`/api/lock/${id}`, { data: { passwordHash } })).status()).toBe(200);
  await page.reload();
  await expect(page.locator('.step')).toHaveCount(1);
  await expandSliceCard(page, 1);
  await expect(body(page)).toHaveValue('Filter by cuisine');
  await expect(page.locator('#cardExpandChips')).toBeHidden();
});
