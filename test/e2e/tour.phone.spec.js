import { test, expect } from './fixtures.js';

const tooltip = (page) => page.locator('#tourTooltip');
const next = (page) => tooltip(page).locator('.tour-btn-next');

// The tour box is inside the window, and nothing covers its Next button
const stepFits = (page) => page.evaluate(() => {
  const box = document.querySelector('#tourTooltip').getBoundingClientRect();
  const button = document.querySelector('#tourTooltip .tour-btn-next').getBoundingClientRect();
  const onTop = document.elementFromPoint(button.left + button.width / 2, button.top + button.height / 2);
  return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
    && !!onTop?.closest('.tour-btn-next');
});

// Overlapping highlights cancel out and leave a dark strip, and the tour box stays clear of them
const highlightsApart = (page) => page.evaluate(() => {
  const boxes = [...document.querySelectorAll('.tour-spotlight')].filter(s => s.style.display !== 'none').map(s => s.getBoundingClientRect());
  boxes.push(document.querySelector('#tourTooltip').getBoundingClientRect());
  return boxes.every((a, i) => boxes.slice(i + 1).every(b => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top));
});

test('on a phone the home page has the tour button first, and the tour is in the menu too', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#welcomeTourBtn')).toBeVisible();
  await expect(page.locator('#welcomeNewBtn')).toBeVisible();
  const [tour, start] = await Promise.all(['#welcomeTourBtn', '#welcomeNewBtn'].map(s => page.locator(s).boundingBox()));
  expect(tour.y < start.y || tour.x < start.x).toBe(true);
  await page.locator('#menuBtn').tap();
  await expect(page.locator('#tourMenuBtn')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#welcomeTourBtn').tap();
  await expect(tooltip(page)).toBeVisible();
});

test('the story map stays put during the step that lets you drag cards', async ({ page }) => {
  await page.goto('/tour');
  await expect(tooltip(page)).toBeVisible();
  while (await tooltip(page).locator('.tour-tooltip-title').textContent() !== 'A first release') {
    const before = await tooltip(page).locator('.tour-tooltip-title').textContent();
    const dot = await page.locator('#tourProgress .tour-progress-dot.active').evaluate(d => [...d.parentNode.children].indexOf(d));
    await next(page).tap();
    await expect(page.locator('#tourProgress .tour-progress-dot').nth(dot + 1)).toHaveClass(/active/);
    expect(before).not.toBeNull();
  }
  // Dragging a card to the edge scrolls the story map like this
  const wrapper = page.locator('#storyMapWrapper');
  await wrapper.evaluate(w => { w.scrollLeft = 120; });
  await expect.poll(() => wrapper.evaluate(w => w.scrollLeft)).toBe(0);
});

// Every step has its box in the window, its highlights apart and the story map at the left of the screen
const tapThroughTour = async (page) => {
  await page.goto('/tour');
  await expect(tooltip(page)).toBeVisible();
  const steps = await page.locator('#tourProgress .tour-progress-dot').count();
  expect(steps).toBeGreaterThan(1);
  for (let step = 1; step <= steps; step++) {
    await expect(page.locator('#tourProgress .tour-progress-dot').nth(step - 1)).toHaveClass(/active/);
    await expect.poll(() => stepFits(page), `step ${step} fits`).toBe(true);
    expect(await highlightsApart(page), `step ${step} highlights`).toBe(true);
    // The story map has not slid sideways: the row labels are in view at the left of the screen.
    // (A screen wider than a phone has room to scroll at each side of the map, so its scroll
    // position is not 0.)
    const label = await page.locator('.row-type-label').first().boundingBox();
    expect(label.x, `step ${step} left edge`).toBeGreaterThanOrEqual(0);
    expect(label.x, `step ${step} left edge`).toBeLessThan(80);
    await next(page).tap();
  }
  await expect(tooltip(page)).toBeHidden();
};

test('every step of the tour fits a phone, and can be tapped through to the end', async ({ page }) => {
  await tapThroughTour(page);
});

// Two tablet sizes held upright: a small one, and a larger one that gets the wider header
for (const viewport of [{ width: 600, height: 1024 }, { width: 800, height: 1280 }]) {
  test.describe(`on a tablet ${viewport.width} wide`, () => {
    test.use({ viewport });

    test('the tour shows the story map at half size, not shrunk to fit, and every step fits', async ({ page }) => {
      await page.goto('/tour');
      await expect(tooltip(page)).toBeVisible();
      await expect(page.locator('#zoomReset')).toHaveText('50%');
      await tapThroughTour(page);
    });
  });
}
