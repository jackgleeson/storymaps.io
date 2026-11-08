import { test, expect, openMap } from './fixtures.js';

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

test('a sample from the menu opens as a new map, with each slice goal and the first target date two weeks away', async ({ page, createMap }) => {
  const id = await createMap();
  await openMap(page, id);
  await page.locator('#menuBtn').click();
  await page.locator('#samplesSubmenuTrigger').click();
  await page.locator('[data-sample="coffee-ordering"]').first().click();
  await expect(page.locator('#boardName')).toHaveValue('Coffee Ordering App');
  await expect(page).not.toHaveURL(new RegExp(id));

  await expect(page.locator('.slice-info')).toHaveCount(4);
  expect(await sliceDetails(page, 0)).toEqual(['Customers can order and pay ahead, then pick up their coffee', await inTwoWeeks(page)]);
  const [goal] = await sliceDetails(page, 1);
  expect(goal).toBe('Customers can make a drink their own, follow their order, and get it delivered');

  // The map that was open is left as it was, and Back returns to it
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/${id}$`));
  await expect(page.locator('#boardName')).toHaveValue('Coffee app');
  expect((await (await page.request.get(`/api/maps/${id}`)).json()).name).toBe('Coffee app');
});

test('a sample from the menu of a project map leaves the project map as it was', async ({ page, createMap, request }) => {
  const id = await createMap();
  const res = await request.post('/api/projects', { data: { mapIds: [id], name: 'Team' }, headers: { origin: 'http://localhost' } });
  expect(res.status()).toBe(201);
  const projectId = (await res.json()).project.id;
  await page.goto(`/p/${projectId}/${id}`);
  await expect(page.locator('#boardName')).toHaveValue('Coffee app');
  await page.locator('#menuBtn').click();
  await page.locator('#samplesSubmenuTrigger').click();
  await page.locator('[data-sample="holiday-rentals"]').first().click();
  await expect(page.locator('#boardName')).toHaveValue('Holiday Rentals App');

  await page.goBack();
  await expect(page).toHaveURL(`/p/${projectId}/${id}`);
  await expect(page.locator('#boardName')).toHaveValue('Coffee app');
  expect((await (await request.get(`/api/maps/${id}`)).json()).name).toBe('Coffee app');
});

test('a sample opened from the welcome page has upcoming dates too', async ({ page }) => {
  await page.goto('/');
  await page.locator('.welcome-screen [data-sample="recipe-app"]').click();
  await expect(page.locator('#boardName')).toHaveValue('Recipe App');
  const [goal, date] = await sliceDetails(page, 0);
  expect(goal).toBe('Find a recipe and cook it step by step');
  expect(date).toBe(await inTwoWeeks(page));
});
