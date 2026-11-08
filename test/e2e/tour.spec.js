import { test, expect } from './fixtures.js';

const tooltip = (page) => page.locator('#tourTooltip');
const title = (page) => tooltip(page).locator('.tour-tooltip-title');
const next = (page) => tooltip(page).locator('.tour-btn-next');

test('the tour runs on the coffee app, adds a Later slice for a step, and leaves the story map as it found it', async ({ page }) => {
  await page.goto('/tour');
  await expect(page.locator('#boardName')).toHaveValue('Coffee App');
  await expect(title(page)).toHaveText('What is a story map?');
  const steps = await page.locator('#tourProgress .tour-progress-dot').count();
  const slices = page.locator('.slice-container');
  await expect(slices).toHaveCount(1);
  const cards = await page.locator('.slice-container .story-card').count();
  const wrapper = page.locator('#storyMapWrapper');
  const opened = await wrapper.evaluate(w => [w.scrollTop, w.scrollLeft]);

  const seen = [];
  for (let i = 0; i < steps; i++) {
    seen.push(await title(page).textContent());
    if (seen.at(-1) === 'The next release') {
      await expect(slices).toHaveCount(2);
      await expect(slices.nth(1)).toContainText('Later');
    }
    // Every step after the first two points at part of the story map, apart from the last
    if (i > 0 && i < steps - 1) await expect(page.locator('#tourSpotlight')).toBeVisible();
    await next(page).click();
  }

  expect(seen).toContain('Users');
  expect(seen).toContain('Release slices');
  expect(seen.at(-1)).toBe('You’re a story mapper');
  await expect(tooltip(page)).not.toHaveClass(/visible/);
  await expect(slices).toHaveCount(1);
  await expect(page.locator('.slice-container .story-card')).toHaveCount(cards);
  // It ends on the whole story map as it opened, not wherever the last step scrolled to
  await expect.poll(() => wrapper.evaluate(w => [w.scrollTop, w.scrollLeft])).toEqual(opened);
  expect(await page.evaluate(() => localStorage.getItem('tourCompleted'))).toBe('true');
});

test('the Lego house is still a sample in the main menu', async ({ page }) => {
  await page.goto('/sample/lego-house');
  await expect(page.locator('#boardName')).toHaveValue('Build a Lego House');
  await page.locator('#menuBtn').click();
  await expect(page.locator('.dropdown-item[data-sample="lego-house"]')).toHaveCount(1);
});
