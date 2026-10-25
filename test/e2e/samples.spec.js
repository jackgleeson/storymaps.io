import { test, expect, openMap, acceptDialog } from './fixtures.js';

// How the app shows a date, worked out in the page so it matches the browser's locale
const inTwoWeeks = (page) => page.evaluate(() => {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
});

const sliceDetails = async (page, sliceIndex) => {
  await page.locator('.slice-info').nth(sliceIndex).hover();
  const tip = page.locator('.slice-info-tip');
  await expect(tip).toBeVisible();
  return tip.locator('dd').allInnerTexts();
};

test('a sample from the menu shows each slice goal, with the first target date two weeks away', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  await page.locator('#menuBtn').click();
  await page.locator('#samplesSubmenuTrigger').click();
  await page.locator('[data-sample="coffee-ordering"]').first().click();
  await acceptDialog(page);
  await expect(page.locator('#boardName')).toHaveValue('Coffee Ordering App');

  await expect(page.locator('.slice-info')).toHaveCount(3);
  expect(await sliceDetails(page, 0)).toEqual(['Customers can order and pay ahead, then pick up their coffee', await inTwoWeeks(page)]);
  const [goal] = await sliceDetails(page, 1);
  expect(goal).toBe('Make repeat and group orders quicker');
});

test('a sample opened from the welcome page has upcoming dates too', async ({ page }) => {
  await page.goto('/');
  await page.locator('.welcome-screen [data-sample="recipe-app"]').click();
  await expect(page.locator('#boardName')).toHaveValue('Recipe App');
  const [goal, date] = await sliceDetails(page, 0);
  expect(goal).toBe('Find a recipe and cook it step by step');
  expect(date).toBe(await inTwoWeeks(page));
});
