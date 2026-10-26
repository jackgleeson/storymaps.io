import { test, expect, openMap } from './fixtures.js';

const map = (name) => `name: ${name}
steps:
  - First
  - Second
slices:
  - name: MVP
    stories:
      First:
        - name: ${name} card
`;

test('on a phone a project starts from the menu, the tabs scroll, the boxes open as a sheet over the controls, and a tab opens its map', async ({ page, createMap }) => {
  const ids = [];
  for (const name of ['Ordering', 'Loyalty programme', 'Barista screen', 'Delivery partners']) ids.push(await createMap(map(name)));
  await openMap(page, ids[0], 2);

  // A map in no project leaves the room to the map; Start a project is in the main menu
  await expect(page.locator('#projectBar')).toBeHidden();
  await page.locator('#menuBtn').tap();
  await page.locator('#projectMenuBtn').tap();
  await expect(page.locator('#projectPanel').getByRole('heading')).toHaveText('Start a project');
  await page.locator('#projectPanel').getByRole('button', { name: 'Create project' }).tap();
  const addBtn = page.locator('#projectAddBtn');
  await expect(page.locator('#projectPanel')).toBeHidden();
  for (const id of ids.slice(1)) {
    await addBtn.tap();
    await page.locator('#projectLinkInput').fill(id);
    await page.locator('#projectPanel').getByRole('button', { name: 'Add', exact: true }).tap();
    await expect(page.locator('#projectPanel')).toBeHidden();
  }

  const tabs = page.locator('#projectTabs .project-tab');
  await expect(tabs).toHaveCount(4);
  const strip = await page.locator('#projectTabs').evaluate(e => ({ scroll: e.scrollWidth, client: e.clientWidth }));
  expect(strip.scroll).toBeGreaterThan(strip.client);
  const viewport = page.viewportSize();
  expect((await page.locator('#projectBar').boundingBox()).width).toBeLessThanOrEqual(viewport.width);
  expect((await tabs.first().boundingBox()).height).toBeGreaterThanOrEqual(40);

  // The manage sheet sits at the bottom, over the map controls, with Done reachable
  await page.locator('#projectName').tap();
  const sheet = await page.locator('#projectPanel').boundingBox();
  expect(Math.round(sheet.y + sheet.height)).toBe(viewport.height);
  expect(sheet.width).toBe(viewport.width);
  const done = page.locator('#projectPanel').getByRole('button', { name: 'Done' });
  const topAtDone = await done.evaluate((btn) => {
    const r = btn.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === btn;
  });
  expect(topAtDone).toBe(true);
  await done.tap();
  await expect(page.locator('#projectPanel')).toBeHidden();

  await tabs.nth(3).tap();
  await expect(page).toHaveURL(new RegExp(`/p/[a-z0-9]{8}/${ids[3]}$`));
  await expect(page.locator('.story-card textarea').first()).toHaveValue('Delivery partners card');
  await expect(tabs.nth(3)).toHaveAttribute('aria-current', 'page');
});
