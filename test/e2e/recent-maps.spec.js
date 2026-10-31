import { test, expect, openMap, acceptDialog } from './fixtures.js';

const map = (name) => `name: ${name}
steps:
  - Browse
  - Order
  - Pay
`;

const homeLine = (page) => page.locator('#recentMapsBtn');
const list = (page) => page.locator('#recentMapsPop');
const rows = (page) => list(page).locator('.recent-row .recent-name');
const menuRows = (page) => page.locator('#recentSubmenu .recent-menu-item .recent-name');

const openRecentInMenu = async (page) => {
  await page.locator('#menuBtn').click();
  await page.locator('#recentSubmenuTrigger').click();
  await expect(page.locator('#recentSubmenu')).toBeVisible();
};

test('maps opened here are listed from the home page, newest first, and open from there', async ({ page, createMap }) => {
  const [a, b] = [await createMap(map('Ordering')), await createMap(map('Loyalty'))];
  await page.goto('/');
  await expect(page.locator('#welcomeNewBtn')).toBeVisible();
  await expect(homeLine(page)).toBeHidden();

  await openMap(page, a);
  await openMap(page, b);
  await page.goto('/');
  await homeLine(page).click();
  await expect(list(page)).toBeVisible();
  await expect(list(page).locator('.recent-title')).toHaveText('Recently opened in this browser');
  await expect(rows(page)).toHaveText(['Loyalty', 'Ordering']);
  await expect(list(page).locator('.recent-when').first()).toHaveText('Just now');
  await expect(list(page).locator('.recent-foot')).toContainText('Bookmark maps you want to keep.');

  // Escape closes it, back on the line that opened it
  await page.keyboard.press('Escape');
  await expect(list(page)).toBeHidden();
  await expect(homeLine(page)).toBeFocused();

  await homeLine(page).click();
  await rows(page).filter({ hasText: 'Ordering' }).click();
  await expect(page).toHaveURL(new RegExp(`/${a}$`));
  await expect(page.locator('#boardName')).toHaveValue('Ordering');
});

test('a map opened in a project is listed as the project, reopening on that map', async ({ page, request, createMap }) => {
  const [a, b] = [await createMap(map('Ordering')), await createMap(map('Loyalty'))];
  const res = await request.post('/api/projects', { data: { mapIds: [a, b], name: 'Coffee app' }, headers: { origin: 'http://localhost' } });
  const project = (await res.json()).project.id;

  await openMap(page, b);
  await page.goto(`/p/${project}/${b}`);
  await expect(page.locator('#projectTabs .project-tab')).toHaveCount(2);
  await page.goto('/');
  await homeLine(page).click();
  await expect(rows(page)).toHaveText(['Coffee app (2)']);
  await expect(list(page).locator('.recent-row')).toHaveAttribute('href', `/p/${project}/${b}`);
});

test('the main menu lists recent maps without the open one, and Clear list empties it', async ({ page, createMap }) => {
  const [a, b] = [await createMap(map('Ordering')), await createMap(map('Loyalty'))];
  await openMap(page, a);
  // With only the open map, there is nothing to list
  await page.locator('#menuBtn').click();
  await expect(page.locator('#recentSubmenuWrap')).toBeHidden();
  await page.keyboard.press('Escape');

  await openMap(page, b);
  await openRecentInMenu(page);
  await expect(menuRows(page)).toHaveText(['Ordering']);
  await menuRows(page).first().click();
  await expect(page).toHaveURL(new RegExp(`/${a}$`));

  await openRecentInMenu(page);
  await expect(menuRows(page)).toHaveText(['Loyalty']);
  await page.locator('#recentSubmenu .recent-menu-clear').click();
  expect(await acceptDialog(page)).toContain('Clear the list of recent maps?');
  await page.goto('/');
  await expect(page.locator('#welcomeNewBtn')).toBeVisible();
  await expect(homeLine(page)).toBeHidden();
});

test('one map can be removed, and a map that no longer exists leaves the list', async ({ page, createMap }) => {
  const [a, b] = [await createMap(map('Ordering')), await createMap(map('Loyalty'))];
  await openMap(page, a);
  await openMap(page, b);
  await page.goto('/');
  await homeLine(page).click();
  await list(page).locator('.recent-item').filter({ hasText: 'Loyalty' }).hover();
  await list(page).getByRole('button', { name: 'Remove Loyalty from recent maps' }).click();
  await expect(rows(page)).toHaveText(['Ordering']);

  // A link to a map the server doesn't have
  await page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('recentMaps'));
    list.unshift({ kind: 'map', id: 'gone0000', name: 'Old map', at: Date.now() });
    localStorage.setItem('recentMaps', JSON.stringify(list));
  });
  await page.goto('/gone0000');
  await expect(page.locator('#welcomeNewBtn')).toBeVisible();
  await homeLine(page).click();
  await expect(rows(page)).toHaveText(['Ordering']);
});

test('naming a map shows the bookmark reminder once for that map', async ({ page, context, createMap }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const [a, b, c] = [await createMap(map('Ordering')), await createMap(map('Loyalty')), await createMap(map('Barista'))];
  const callout = page.locator('#bookmarkNudge');
  const rename = async (name) => {
    await page.locator('#boardName').fill(name);
    await page.keyboard.press('Enter');
  };

  // Opening a map and editing a card doesn't show it
  await openMap(page, a);
  await page.locator('.step .step-text').first().fill('Menu');
  await page.locator('.step .step-text').first().blur();
  await expect(callout).toBeHidden();

  await rename('Ordering v2');
  await expect(callout).toBeVisible();
  await expect(callout).toContainText('Bookmark this map');
  await expect(callout).toContainText('Bookmark it to come back to it any time. Press Ctrl + D.');
  // It sits under the title
  const title = await page.locator('#boardName').boundingBox();
  const box = await callout.boundingBox();
  expect(box.y).toBeGreaterThan(title.y + title.height);
  expect(Math.abs((box.x + box.width / 2) - (title.x + title.width / 2))).toBeLessThan(2);

  await callout.getByRole('button', { name: 'Copy link' }).click();
  await expect(callout.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${new URL(page.url()).origin}/${a}`);
  await callout.getByRole('button', { name: 'Got it' }).click();
  await expect(callout).toBeHidden();

  // Not again for this map, even after a reload
  await rename('Ordering v3');
  await page.reload();
  await expect(page.locator('.step')).toHaveCount(3);
  await rename('Ordering v4');
  await expect(callout).toBeHidden();

  // Another map shows it, and Don't show again stops it everywhere
  await openMap(page, b);
  await rename('Loyalty v2');
  await expect(callout).toBeVisible();
  await callout.getByRole('button', { name: "Don't show again" }).click();
  await expect(callout).toBeHidden();
  await openMap(page, c);
  await rename('Barista v2');
  await expect(callout).toBeHidden();
});

test('the main menu shows above the map panel in a short window', async ({ page, createMap }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  // A map with a slice, so the panel has its full height
  const id = await createMap();
  await openMap(page, id);
  await page.locator('#menuBtn').click();
  const last = page.locator('#mainMenu .dropdown-item:visible').last();
  await expect(last).toContainText('Lock Map');
  const box = await last.boundingBox();
  const topmost = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('#mainMenu') !== null, [box.x + box.width / 2, box.y + box.height / 2]);
  expect(topmost).toBe(true);
});

test('maps opened recently can go into a new project, and be added to one', async ({ page, createMap }) => {
  const [a, b, c, d] = [await createMap(map('Ordering')), await createMap(map('Loyalty')), await createMap(map('Barista')), await createMap(map('Delivery'))];
  const panel = page.locator('#projectPanel');
  const picks = panel.locator('.project-recent .project-recent-name');
  for (const id of [d, c, b, a]) await openMap(page, id);

  // Start a project on Ordering, which is always in, ticking Loyalty
  await page.locator('#projectAddBtn').click();
  await expect(panel.getByLabel('Project name')).toBeFocused();
  await expect(panel.getByText("Maps you've opened recently")).toBeVisible();
  await expect(picks).toHaveText(['Ordering (this map)', 'Loyalty', 'Barista', 'Delivery']);
  await expect(panel.getByLabel('Ordering (this map)')).toBeChecked();
  await expect(panel.getByLabel('Ordering (this map)')).toBeDisabled();
  await expect(panel.locator('.project-recent-when').first()).toHaveText('Just now');
  await panel.getByLabel('Project name').fill('Coffee app');
  await panel.getByLabel('Loyalty').check();
  await expect(panel.getByRole('button', { name: 'Create project with 2 maps' })).toBeVisible();
  await panel.getByRole('button', { name: 'Create project with 2 maps' }).click();
  await expect(panel).toBeHidden();
  await expect(page.locator('#projectTabs .project-tab')).toHaveText(['Ordering', 'Loyalty']);

  // Add map lists the recent maps not in the project yet, and adds the ticked ones in one go
  await page.locator('#projectAddBtn').click();
  await expect(panel.getByRole('heading')).toHaveText('Add maps to Coffee app');
  await expect(panel.getByLabel('Barista')).toBeFocused();
  await expect(picks).toHaveText(['Barista', 'Delivery']);
  await expect(panel.getByRole('button', { name: 'Add maps', exact: true })).toBeDisabled();
  await panel.getByLabel('Barista').check();
  await panel.getByLabel('Delivery').check();
  await panel.getByRole('button', { name: 'Add 2 maps' }).click();
  await expect(panel).toBeHidden();
  await expect(page.locator('#projectTabs .project-tab')).toHaveText(['Ordering', 'Loyalty', 'Barista', 'Delivery']);

  // With every recent map in, the box is as it was
  await page.locator('#projectAddBtn').click();
  await expect(panel.getByRole('heading')).toHaveText('Add a map to Coffee app');
  await expect(panel.getByRole('button', { name: 'New map' })).toBeFocused();
});

test('a map in a project shows no map reminder; the project shows its own when started or renamed', async ({ page, request, context, createMap }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const [a, b, c] = [await createMap(map('Ordering')), await createMap(map('Loyalty')), await createMap(map('Barista'))];
  const res = await request.post('/api/projects', { data: { mapIds: [a, b], name: 'Coffee app' }, headers: { origin: 'http://localhost' } });
  const project = (await res.json()).project.id;
  const callout = page.locator('#bookmarkNudge');
  const panel = page.locator('#projectPanel');

  // Renaming a map open in its project
  await page.goto(`/p/${project}/${a}`);
  await expect(page.locator('#projectTabs .project-tab')).toHaveCount(2);
  await page.locator('#boardName').fill('Ordering v2');
  await page.keyboard.press('Enter');
  await expect(page.locator('#projectTabs .project-tab').first()).toHaveText('Ordering v2');
  await expect(callout).toBeHidden();

  // Renaming the project shows it once the box closes, under the project name
  await page.locator('#projectName').click();
  await panel.getByLabel('Name', { exact: true }).fill('Coffee shop');
  await page.keyboard.press('Enter');
  await expect(page.locator('#projectName')).toContainText('Coffee shop');
  await expect(callout).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(callout).toBeVisible();
  await expect(callout).toContainText('Bookmark this project');
  await expect(callout).toContainText('Bookmark it to come back to it and its maps any time. Press Ctrl + D.');
  const name = await page.locator('#projectName').boundingBox();
  expect((await callout.boundingBox()).y).toBeGreaterThan(name.y + name.height);
  await callout.getByRole('button', { name: 'Copy link' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${new URL(page.url()).origin}/p/${project}`);
  await callout.getByRole('button', { name: 'Got it' }).click();

  // Once per project
  await page.locator('#projectName').click();
  await panel.getByLabel('Name', { exact: true }).fill('Coffee shop 2');
  await page.keyboard.press('Enter');
  await expect(page.locator('#projectName')).toContainText('Coffee shop 2');
  await panel.getByRole('button', { name: 'Done' }).click();
  await expect(callout).toBeHidden();

  // Starting a project shows it
  await openMap(page, c);
  await page.locator('#projectAddBtn').click();
  await panel.getByRole('button', { name: 'Create project' }).click();
  await expect(callout).toContainText('Bookmark this project');
  await expect(page.locator('#appToast')).not.toContainText('Project created');
});
