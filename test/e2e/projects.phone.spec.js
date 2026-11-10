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

test('on a phone the kind of lock shows under the map name', async ({ page, createMap, request }) => {
  const a = await createMap(map('Ordering'));
  const headers = { origin: 'http://localhost' };
  const project = (await (await request.post('/api/projects', { data: { mapIds: [a], name: 'Cafe' }, headers })).json()).project.id;
  await request.post(`/api/projects/${project}/lock`, { data: { passwordHash: 'a'.repeat(64), lockMaps: true }, headers });
  await page.goto(`/p/${project}/${a}`);
  await page.locator('#projectName').tap();
  const panel = page.locator('#projectPanel');
  const label = panel.locator('.project-panel-lock-label');
  await expect(label).toHaveText('Project lock');
  const [name, under] = [await panel.locator('.project-panel-item-name').boundingBox(), await label.boundingBox()];
  expect(under.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
});

test('on a phone a map row opened for a password keeps its height and its buttons can be tapped', async ({ page, createMap, request }) => {
  const ids = [await createMap(map('Ordering')), await createMap(map('Loyalty')), await createMap(map('Barista'))];
  const headers = { origin: 'http://localhost' };
  const project = (await (await request.post('/api/projects', { data: { mapIds: ids, name: 'Cafe' }, headers })).json()).project.id;
  await request.post(`/api/projects/${project}/lock`, { data: { passwordHash: 'a'.repeat(64), lockMaps: true }, headers });
  await page.goto(`/p/${project}/${ids[0]}`);
  await page.locator('#projectName').tap();
  const panel = page.locator('#projectPanel');
  await panel.getByRole('button', { name: 'Unlock Loyalty' }).tap();
  const prompting = panel.locator('.project-panel-item.prompting');
  const content = await prompting.evaluate(row => row.scrollHeight);
  // scrollHeight is a whole number, so it can round up by a fraction of a pixel
  expect((await prompting.boundingBox()).height).toBeGreaterThanOrEqual(content - 1);
  const cancel = prompting.getByRole('button', { name: 'Cancel' });
  const [button, row] = [await cancel.boundingBox(), await prompting.boundingBox()];
  expect(button.x + button.width).toBeLessThanOrEqual(row.x + row.width);
  await cancel.tap();
  await expect(prompting).toHaveCount(0);
});
