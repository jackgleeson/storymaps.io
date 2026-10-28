import { test, expect, openMap, stepNames } from './fixtures.js';

// Each of these starts the scroll-linked animation afresh. The rows must sit at the top straight
// away, with no further scrolling.

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

const usersTop = (page) => page.evaluate(() =>
  document.querySelector('#storyMap .users-row').getBoundingClientRect().top -
  document.getElementById('storyMapWrapper').getBoundingClientRect().top);

test('on a phone, the rows sit at the top after a single jump, a zoom and a redraw', async ({ page, createMap, openSecondTab }) => {
  await page.addInitScript(() => localStorage.setItem('freezeRows', 'all'));
  const id = await createMap(LONG_MAP);
  await openMap(page, id);

  await page.locator('#storyMapWrapper').evaluate(el => { el.scrollTop += 700; });
  await expect.poll(async () => Math.abs(await usersTop(page))).toBeLessThan(1.5);

  await page.locator('#zoomOut').tap();
  await expect.poll(async () => Math.abs(await usersTop(page))).toBeLessThan(1.5);

  const other = await openSecondTab();
  await openMap(other, id);
  const first = other.locator('.step .step-text').first();
  await first.click();
  await first.fill('Menu');
  await first.blur();
  await expect.poll(() => stepNames(page)).toContain('Menu');
  await expect.poll(async () => Math.abs(await usersTop(page))).toBeLessThan(1.5);
});
