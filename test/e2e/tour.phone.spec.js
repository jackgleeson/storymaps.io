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

test('on a phone the home page leads with Start Mapping, and the tour is in the menu', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#welcomeNewBtn')).toBeVisible();
  await expect(page.locator('#welcomeTourBtn')).toBeHidden();
  await page.locator('#menuBtn').tap();
  await expect(page.locator('#tourMenuBtn')).toBeVisible();
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

test('every step of the tour fits a phone, and can be tapped through to the end', async ({ page }) => {
  await page.goto('/tour');
  await expect(tooltip(page)).toBeVisible();
  const steps = await page.locator('#tourProgress .tour-progress-dot').count();
  expect(steps).toBeGreaterThan(1);
  for (let step = 1; step <= steps; step++) {
    await expect(page.locator('#tourProgress .tour-progress-dot').nth(step - 1)).toHaveClass(/active/);
    await expect.poll(() => stepFits(page), `step ${step} fits`).toBe(true);
    expect(await highlightsApart(page), `step ${step} highlights`).toBe(true);
    // Scrolled sideways, the row labels sit against the edge of the screen
    expect(await page.locator('#storyMapWrapper').evaluate(w => w.scrollLeft), `step ${step} scroll`).toBe(0);
    await next(page).tap();
  }
  await expect(tooltip(page)).toBeHidden();
});
