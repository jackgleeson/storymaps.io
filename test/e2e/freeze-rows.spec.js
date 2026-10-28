import { test, expect, openMap, stepNames } from './fixtures.js';

// A map tall enough to scroll well past the top rows
const LONG_MAP = `name: Long map
users:
  - name: Customer
activities:
  - name: Order coffee
steps:
  - Browse
  - Order
  - Pay
slices:
  - name: MVP
    stories:
      Browse:
${Array.from({ length: 24 }, (_, i) => `        - name: Card ${i + 1}`).join('\n')}
`;

// How far each top row sits below the top of the map area, in screen pixels
const rowTops = (page) => page.evaluate(() => {
  const top = document.getElementById('storyMapWrapper').getBoundingClientRect().top;
  const at = (cls) => document.querySelector(`#storyMap .${cls}`).getBoundingClientRect().top - top;
  return { users: at('users-row'), activities: at('activities-row'), steps: at('steps-row') };
});

const scrollDown = (page, px) => page.locator('#storyMapWrapper').evaluate((el, px) => { el.scrollTop += px; }, px);

const choose = async (page, value) => {
  await page.locator('#toggleFreezeBtn').click();
  await page.locator(`#freezeMenu input[value="${value}"]`).check();
  await page.keyboard.press('Escape');
  await expect(page.locator('#freezeMenu')).toBeHidden();
};

test('rows chosen in the menu stay at the top while scrolling, at any zoom', async ({ page, createMap }) => {
  const id = await createMap(LONG_MAP);
  await openMap(page, id);
  // Users, activities and steps are frozen until someone picks otherwise
  await expect(page.locator('#freezeMenu input[value="all"]')).toBeChecked();
  await expect(page.locator('#toggleFreezeBtn')).toHaveClass(/active/);

  await choose(page, 'steps');
  await expect(page.locator('#toggleFreezeBtn')).toHaveClass(/active/);
  await scrollDown(page, 900);
  await expect.poll(async () => Math.abs((await rowTops(page)).steps)).toBeLessThan(1.5);
  expect((await rowTops(page)).users).toBeLessThan(-20);

  // Zooming while scrolled keeps the steps at the top
  await page.locator('#zoomOut').click();
  await scrollDown(page, 200);
  await expect.poll(async () => Math.abs((await rowTops(page)).steps)).toBeLessThan(1.5);

  // All three rows stack at the top, in order
  await choose(page, 'all');
  await expect.poll(async () => Math.abs((await rowTops(page)).users)).toBeLessThan(1.5);
  const all = await rowTops(page);
  expect(all.activities).toBeGreaterThan(all.users);
  expect(all.steps).toBeGreaterThan(all.activities);

  // Nothing lets them scroll away again
  await choose(page, 'off');
  await expect(page.locator('.frozen-row')).toHaveCount(0);
  expect((await rowTops(page)).steps).toBeLessThan(-20);
});

test('the choice is kept for this browser, and frozen steps can still be edited', async ({ page, createMap, pullMap, openSecondTab }) => {
  const id = await createMap(LONG_MAP);
  await openMap(page, id);
  await choose(page, 'activities');

  await page.reload();
  await expect(page.locator('.step')).toHaveCount(3);
  await expect(page.locator('#freezeMenu input[value="activities"]')).toBeChecked();
  await scrollDown(page, 900);
  await expect.poll(async () => Math.abs((await rowTops(page)).activities)).toBeLessThan(1.5);

  // Rename a step while it is frozen at the top
  const pay = page.locator('.step .step-text').nth(2);
  await pay.click();
  await pay.fill('Checkout');
  await pay.blur();
  await expect.poll(async () => (await pullMap(id)).steps.map(s => s.name ?? s)).toContain('Checkout');

  // A change from someone else redraws the map; the rows stay frozen
  const other = await openSecondTab();
  await openMap(other, id);
  const otherFirst = other.locator('.step .step-text').first();
  await otherFirst.click();
  await otherFirst.fill('Menu');
  await otherFirst.blur();
  await expect.poll(() => stepNames(page)).toContain('Menu');
  await expect.poll(async () => Math.abs((await rowTops(page)).activities)).toBeLessThan(1.5);
  expect(await stepNames(page)).toContain('Checkout');
});

test('zooming in at the top keeps the rows in place, not stuck over the cards below', async ({ page, createMap }) => {
  const id = await createMap(LONG_MAP);
  await page.addInitScript(() => localStorage.setItem('freezeRows', 'all'));
  await openMap(page, id);

  for (let i = 0; i < 4; i++) await page.locator('#zoomIn').click();
  await expect(page.locator('#storyMapWrapper')).not.toHaveClass(/rows-stuck/);
  const gap = await page.evaluate(() => {
    const steps = document.querySelector('#storyMap .steps-row').getBoundingClientRect();
    const card = document.querySelector('#storyMap .slice-container .story-card').getBoundingClientRect();
    return card.top - steps.bottom;
  });
  expect(gap).toBeGreaterThan(0);
});

// Where another person's cursor tip is drawn, and whether it lies inside an element on this screen
const cursorInside = (page, selector) => page.evaluate((selector) => {
  const cursor = document.querySelector('.remote-cursor');
  if (!cursor) return false;
  const tip = cursor.getBoundingClientRect();
  const box = document.querySelector(selector).getBoundingClientRect();
  return tip.left >= box.left && tip.left <= box.right && tip.top >= box.top && tip.top <= box.bottom;
}, selector);

const pointAt = async (page, selector) => {
  const box = await page.locator(selector).boundingBox();
  await page.mouse.move(box.x + box.width / 2 - 5, box.y + box.height / 2 - 5);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
};

test('a cursor over the frozen rows shows over the same rows on the other screen', async ({ page, createMap, openSecondTab }) => {
  const id = await createMap(LONG_MAP);
  const other = await openSecondTab();
  await openMap(page, id);
  await openMap(other, id);

  // One screen scrolled with its rows frozen at the top, the other at the top of the map
  await scrollDown(page, 900);
  await expect(page.locator('#storyMapWrapper')).toHaveClass(/rows-stuck/);
  await expect(other.locator('#storyMapWrapper')).not.toHaveClass(/rows-stuck/);

  await pointAt(page, '.step:nth-child(4)');
  await expect.poll(() => cursorInside(other, '.step:nth-child(4)')).toBe(true);

  await pointAt(other, '.step:nth-child(2)');
  await expect.poll(() => cursorInside(page, '.step:nth-child(2)')).toBe(true);

  // Still over the step after this screen scrolls further, as the frozen rows don't move
  await scrollDown(page, 200);
  await expect.poll(() => cursorInside(page, '.step:nth-child(2)')).toBe(true);
});
