import { test, expect, openMap, acceptDialog, openMenu } from './fixtures.js';

const map = (name, a = 'First', b = 'Second') => `name: ${name}
steps:
  - ${a}
  - ${b}
slices:
  - name: MVP
    stories:
      ${a}:
        - name: ${name} card
`;

const tabs = (page) => page.locator('#projectTabs .project-tab');
const panel = (page) => page.locator('#projectPanel');
const projectName = (page) => page.locator('#projectName');
const projectOf = (page) => new URL(page.url()).pathname.match(/^\/p\/([a-z0-9]+)\//)?.[1];

// Start a project from the open map
const startProject = async (page, name = '') => {
  await page.locator('#projectAddBtn').click();
  await expect(panel(page).getByRole('heading')).toHaveText('Start a project');
  if (name) await panel(page).getByLabel('Project name').fill(name);
  await panel(page).getByRole('button', { name: 'Create project' }).click();
  await expect(panel(page)).toBeHidden();
  await expect(page).toHaveURL(/\/p\/[a-z0-9]{8}\//);
};

// Add a map to the open project by pasting its link, starting the project first if need be
const addByLink = async (page, id) => {
  if (await page.locator('#projectAddBtn').innerText() === 'Start a project') await startProject(page);
  await page.locator('#projectAddBtn').click();
  await expect(panel(page)).toBeVisible();
  await panel(page).getByLabel('Or paste the link to a map you have').fill(`${new URL(page.url()).origin}/${id}`);
  await panel(page).getByRole('button', { name: 'Add', exact: true }).click();
  await expect(panel(page)).toBeHidden();
};

// The map as the server has it, without the time it was read
const pullContent = async (pullMap, id) => {
  const { exported, ...content } = await pullMap(id);
  return content;
};

test('a map in no project offers to start one, which asks only for a name', async ({ page, createMap }) => {
  const [a, b] = [await createMap(map('Ordering')), await createMap(map('Loyalty'))];
  await openMap(page, a, 2);
  await expect(page.locator('#projectAddBtn')).toHaveText('Start a project');
  await expect(page.locator('#projectHint')).toHaveText('Manage multiple maps in one place');
  await expect(tabs(page)).toHaveCount(0);
  await expect(projectName(page)).toBeHidden();

  await page.locator('#projectAddBtn').click();
  await expect(panel(page).getByRole('heading')).toHaveText('Start a project');
  await expect(panel(page).getByLabel('Project name')).toBeFocused();
  await expect(panel(page).getByRole('button', { name: 'New map' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
  await expect(page.locator('#projectAddBtn')).toBeFocused();

  await startProject(page, 'Coffee App');
  await expect(page).toHaveURL(new RegExp(`/p/[a-z0-9]{8}/${a}$`));
  const project = projectOf(page);
  await expect(projectName(page)).toHaveText('Coffee App');
  await expect(tabs(page)).toHaveText(['Ordering']);
  await expect(tabs(page).first()).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#projectAddBtn')).toHaveText('Add map');
  await expect(page.locator('#projectHint')).toBeHidden();

  await addByLink(page, b);
  await expect(tabs(page)).toHaveText(['Ordering', 'Loyalty']);
  await expect(tabs(page).nth(1)).toHaveAttribute('href', `/p/${project}/${b}`);
});

test('a project started without a name is untitled', async ({ page, createMap }) => {
  await openMap(page, await createMap(map('Ordering')), 2);
  await startProject(page);
  await expect(projectName(page)).toHaveText('Untitled project');
});

test('a map link on its own never shows projects, even for a map in one', async ({ page, createMap }) => {
  const [a, b] = [await createMap(map('Ordering')), await createMap(map('Loyalty'))];
  await openMap(page, a, 2);
  await addByLink(page, b);
  await expect(tabs(page)).toHaveCount(2);

  await openMap(page, b, 2);
  await expect(tabs(page)).toHaveCount(0);
  await expect(page.locator('#projectAddBtn')).toHaveText('Start a project');
});

test('tabs open each map fresh at the project link, and back returns to the last one', async ({ page, createMap }) => {
  const [a, b] = [await createMap(map('Ordering', 'Browse', 'Pay')), await createMap(map('Loyalty', 'Join', 'Redeem'))];
  await openMap(page, a, 2);
  await addByLink(page, b);
  const project = projectOf(page);

  await tabs(page).nth(1).click();
  await expect(page).toHaveURL(new RegExp(`/p/${project}/${b}$`));
  await expect(page.locator('.step .step-text').first()).toHaveValue('Join');
  await expect(tabs(page)).toHaveText(['Ordering', 'Loyalty']);
  await expect(tabs(page).nth(1)).toHaveAttribute('aria-current', 'page');

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/p/${project}/${a}$`));
  await expect(page.locator('.step .step-text').first()).toHaveValue('Browse');
  await expect(tabs(page).first()).toHaveAttribute('aria-current', 'page');
});

test('a map in two projects shows each one at its own link', async ({ page, createMap }) => {
  const [shared, b, c] = [await createMap(map('Shared')), await createMap(map('Coffee')), await createMap(map('Tutorial'))];
  await openMap(page, shared, 2);
  await addByLink(page, b);
  const first = projectOf(page);

  await openMap(page, shared, 2);
  await addByLink(page, c);
  const second = projectOf(page);
  expect(second).not.toBe(first);
  await expect(tabs(page)).toHaveText(['Shared', 'Tutorial']);

  await page.goto(`/p/${first}/${shared}`);
  await expect(tabs(page)).toHaveText(['Shared', 'Coffee']);
});

test('a link to a project alone opens its first map', async ({ page, createMap }) => {
  const [a, b] = [await createMap(map('Ordering', 'Browse', 'Pay')), await createMap(map('Loyalty', 'Join', 'Redeem'))];
  await openMap(page, b, 2);
  await addByLink(page, a);
  const project = projectOf(page);

  await page.goto(`/p/${project}`);
  await expect(page).toHaveURL(new RegExp(`/p/${project}/${b}$`));
  await expect(page.locator('.step .step-text').first()).toHaveValue('Join');
  await expect(tabs(page)).toHaveText(['Loyalty', 'Ordering']);

  // A slash on the end, as people often type it, opens the same map
  await page.goto(`/p/${project}/`);
  await expect(page).toHaveURL(new RegExp(`/p/${project}/${b}$`));
  await expect(tabs(page)).toHaveText(['Loyalty', 'Ordering']);
});

test('a broken project link says so, and a project link to a map not in it shows the map alone', async ({ page, createMap }) => {
  const [a, b, c] = [await createMap(map('Ordering')), await createMap(map('Loyalty')), await createMap(map('Barista'))];
  await page.goto('/p/zzzzzzzzzz');
  expect(await acceptDialog(page)).toContain("This project link doesn't open anything");
  await expect(page.locator('#welcomeScreen')).toBeVisible();

  await openMap(page, a, 2);
  await addByLink(page, b);
  const project = projectOf(page);
  await page.goto(`/p/${project}/${c}`);
  await expect(page.locator('.step')).toHaveCount(2);
  await expect(page).toHaveURL(new RegExp(`/${c}$`));
  await expect(page).not.toHaveURL(/\/p\//);
  await expect(tabs(page)).toHaveCount(0);
});

test('New map makes a map in the project, and its tab follows its title', async ({ page, createMap }) => {
  const a = await createMap(map('Ordering'));
  await openMap(page, a, 2);
  await startProject(page);
  await page.locator('#projectAddBtn').click();
  await panel(page).getByRole('button', { name: 'New map' }).click();

  await expect(page).toHaveURL(/\/p\/[a-z0-9]{8}\/[a-z0-9]+$/);
  await expect(page).not.toHaveURL(new RegExp(`/${a}$`));
  await expect(page).not.toHaveURL(/\/new$/);
  await expect(tabs(page)).toHaveText(['Ordering', 'Untitled map']);
  await expect(tabs(page).nth(1)).toHaveAttribute('aria-current', 'page');
  const [, project, newId] = new URL(page.url()).pathname.match(/^\/p\/([a-z0-9]+)\/([a-z0-9]+)$/);

  await page.locator('#boardName').fill('Barista');
  await expect(tabs(page).nth(1)).toHaveText('Barista');

  // The first map lists it too, by the name the server now has
  await tabs(page).first().click();
  await expect(page).toHaveURL(new RegExp(`/p/${project}/${a}$`));
  await expect(tabs(page)).toHaveText(['Ordering', 'Barista']);
  await expect(tabs(page).nth(1)).toHaveAttribute('href', `/p/${project}/${newId}`);
});

test('a new map for a project that no longer exists is not created', async ({ page }) => {
  let created = false;
  page.on('request', (req) => { if (req.url().includes('/api/maps/new-id')) created = true; });
  await page.goto('/p/zzzzzzzz/new');
  expect(await acceptDialog(page)).toBe('This project no longer exists, so no new map was created.');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('#welcomeScreen')).toBeVisible();
  expect(created).toBe(false);
});

test('a full project offers nothing to add, and a new map for it is not created', async ({ page, request }) => {
  // 20 maps, each from its own address so the limit on new maps doesn't decide the test
  const ids = [];
  for (let i = 0; i < 20; i++) {
    const res = await request.post('/api/maps', {
      data: map(`Map ${i + 1}`),
      headers: { 'Content-Type': 'text/yaml', 'X-Forwarded-For': `198.19.${i}.${Math.floor(Math.random() * 250)}` },
    });
    ids.push((await res.json()).id);
  }
  const res = await request.post('/api/projects', { data: { mapIds: ids, name: 'Full' }, headers: { origin: 'http://localhost' } });
  expect(res.status()).toBe(201);
  const project = (await res.json()).project.id;

  await page.goto(`/p/${project}/${ids[1]}`);
  await expect(tabs(page)).toHaveCount(20);
  await page.locator('#projectAddBtn').click();
  await expect(panel(page)).toContainText('This project has 20 maps, the most a project can hold. Remove a map to add another.');
  await expect(panel(page).getByRole('button', { name: 'New map' })).toHaveCount(0);
  await expect(panel(page).getByLabel('Or paste the link to a map you have')).toHaveCount(0);

  let created = false;
  page.on('request', (req) => { if (req.url().includes('/api/maps/new-id')) created = true; });
  await page.goto(`/p/${project}/new`);
  expect(await acceptDialog(page)).toBe('Full already has 20 maps, the most a project can hold, so no new map was created.');
  await expect(page).toHaveURL(new RegExp(`/p/${project}/${ids[0]}$`));
  await expect(tabs(page).first()).toHaveAttribute('aria-current', 'page');
  expect(created).toBe(false);
});

test('the project box renames the project, reorders maps and takes them out', async ({ page, createMap }) => {
  const [a, b, c] = [await createMap(map('Ordering')), await createMap(map('Loyalty')), await createMap(map('Barista'))];
  await openMap(page, a, 2);
  await addByLink(page, b);
  await addByLink(page, c);
  await expect(tabs(page)).toHaveText(['Ordering', 'Loyalty', 'Barista']);

  await projectName(page).click();
  await expect(panel(page).getByRole('heading')).toHaveText('Project');
  const name = panel(page).getByLabel('Name');
  await name.fill('Coffee App');
  await name.press('Enter');
  await expect(projectName(page)).toHaveText('Coffee App');

  await panel(page).getByRole('button', { name: 'Move Barista up' }).click();
  await expect(tabs(page)).toHaveText(['Ordering', 'Barista', 'Loyalty']);
  await expect(panel(page).getByRole('button', { name: 'Move Barista up' })).toBeFocused();
  await expect(panel(page).getByRole('button', { name: 'Move Ordering up' })).toBeDisabled();
  await expect(panel(page).getByRole('button', { name: 'Move Loyalty down' })).toBeDisabled();

  await panel(page).getByRole('button', { name: 'Remove Loyalty from the project' }).click();
  expect(await acceptDialog(page)).toBe(`Remove "Loyalty" from Coffee App?\n\nThe map isn't deleted, and still opens at ${new URL(page.url()).host}/${b}.`);
  await expect(tabs(page)).toHaveText(['Ordering', 'Barista']);
  await expect(panel(page).locator('.project-panel-item')).toHaveCount(2);

  // Taking out the map you're on shows it on its own, at its own link
  await panel(page).getByRole('button', { name: 'Remove Ordering from the project' }).click();
  await acceptDialog(page);
  await expect(tabs(page)).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/${a}$`));
  await expect(page).not.toHaveURL(/\/p\//);
  await expect(page.locator('#projectAddBtn')).toHaveText('Start a project');
});

test('someone else on the same project sees tab changes straight away', async ({ page, createMap, openSecondTab }) => {
  const [a, b, c] = [await createMap(map('Ordering')), await createMap(map('Loyalty')), await createMap(map('Barista'))];
  await openMap(page, a, 2);
  await addByLink(page, b);
  const other = await openSecondTab();
  await other.goto(page.url());
  await expect(tabs(other)).toHaveText(['Ordering', 'Loyalty']);

  await addByLink(page, c);
  // Well inside the 30 second refresh, so this comes from the signal
  await expect(tabs(other)).toHaveText(['Ordering', 'Loyalty', 'Barista'], { timeout: 5000 });
});

test('project changes leave every map exactly as it was', async ({ page, createMap, pullMap }) => {
  const [a, b] = [await createMap(map('Ordering')), await createMap(map('Loyalty'))];
  const before = [await pullContent(pullMap, a), await pullContent(pullMap, b)];
  await openMap(page, a, 2);
  await addByLink(page, b);
  await projectName(page).click();
  await panel(page).getByLabel('Name').fill('Renamed');
  await panel(page).getByLabel('Name').press('Enter');
  await panel(page).getByRole('button', { name: 'Move Loyalty up' }).click();
  await panel(page).getByRole('button', { name: 'Remove Loyalty from the project' }).click();
  await acceptDialog(page);
  await expect(tabs(page)).toHaveText(['Ordering']);
  await tabs(page).first().click();
  await expect(page.locator('.step')).toHaveCount(2);
  expect([await pullContent(pullMap, a), await pullContent(pullMap, b)]).toEqual(before);
});

test('the add box explains what it can not add', async ({ page, createMap }) => {
  const [a, b] = [await createMap(map('Ordering')), await createMap(map('Loyalty'))];
  await openMap(page, a, 2);
  await addByLink(page, b);

  await page.locator('#projectAddBtn').click();
  const input = panel(page).getByLabel('Or paste the link to a map you have');
  const error = panel(page).getByRole('alert');
  await input.fill('not a link');
  await input.press('Enter');
  await expect(error).toContainText('Paste a map link');
  await input.fill(a);
  await input.press('Enter');
  await expect(error).toHaveText("That's the map you're on. Paste a link to a different map.");
  await input.fill('zzzzzzzz');
  await input.press('Enter');
  await expect(error).toHaveText('Map not found');
  await input.fill(b);
  await input.press('Enter');
  await expect(error).toHaveText('That map is already in this project');
  await expect(tabs(page)).toHaveCount(2);
});

test('the main menu starts a project, then manages it', async ({ page, createMap }) => {
  const [a, b] = [await createMap(map('Ordering')), await createMap(map('Loyalty'))];
  await openMap(page, a, 2);
  await page.locator('#menuBtn').click();
  await expect(page.locator('#projectMenuBtn')).toHaveText(/Start a project/);
  await page.locator('#projectMenuBtn').click();
  await expect(panel(page).getByRole('heading')).toHaveText('Start a project');
  await page.keyboard.press('Escape');

  await addByLink(page, b);
  await openMenu(page, 'projectMenuBtn');
  await expect(panel(page).getByRole('heading')).toHaveText('Project');
  await page.locator('#menuBtn').click();
  await expect(page.locator('#projectMenuBtn')).toHaveText(/Manage project/);
});

test('the home page shows no tabs', async ({ page, createMap }) => {
  const [a, b] = [await createMap(map('Ordering')), await createMap(map('Loyalty'))];
  await openMap(page, a, 2);
  await addByLink(page, b);
  await page.goto('/');
  await expect(page.locator('#welcomeScreen')).toBeVisible();
  await expect(page.locator('#projectBar')).toBeHidden();
  await page.locator('#menuBtn').click();
  await expect(page.locator('#newMapBtn')).toBeVisible();
  await expect(page.locator('#projectMenuBtn')).toBeHidden();
});

test('map and project names show as text', async ({ page, createMap }) => {
  const [a, b] = [await createMap(map('Ordering')), await createMap(map('<img src=x onerror=window.hacked=1>'))];
  await openMap(page, a, 2);
  await addByLink(page, b);
  await expect(tabs(page).nth(1)).toHaveText('<img src=x onerror=window.hacked=1>');
  expect(await page.evaluate(() => window.hacked)).toBeUndefined();
});

test('maps can be dragged into a new order by their handles', async ({ page, createMap }) => {
  const [a, b, c] = [await createMap(map('Ordering')), await createMap(map('Loyalty')), await createMap(map('Barista'))];
  await openMap(page, a, 2);
  await addByLink(page, b);
  await addByLink(page, c);
  await projectName(page).click();
  const rows = panel(page).locator('.project-panel-item');
  await expect(rows).toHaveCount(3);
  // Dragging works once the drag library has loaded
  await expect(panel(page).locator('#projectMapsList')).toHaveAttribute('data-sortable', 'ready');

  // Drag Barista up past each row in turn, pausing so the list can move out of the way
  const from = await rows.nth(2).locator('.project-panel-grip').boundingBox();
  const x = from.x + from.width / 2;
  await page.mouse.move(x, from.y + from.height / 2);
  await page.mouse.down();
  for (const row of [1, 0]) {
    const box = await rows.nth(row).boundingBox();
    await page.mouse.move(x, box.y + box.height / 4, { steps: 8 });
    await page.waitForTimeout(150);
  }
  await page.mouse.move(x, (await rows.nth(0).boundingBox()).y + 2, { steps: 4 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await expect(tabs(page)).toHaveText(['Barista', 'Ordering', 'Loyalty']);
  await expect(rows.locator('.project-panel-item-name')).toHaveText(['Barista', 'Ordering (this map)', 'Loyalty']);
});

test('removing the last map keeps the project, and its link offers a new map', async ({ page, createMap }) => {
  const a = await createMap(map('Ordering'));
  await openMap(page, a, 2);
  await startProject(page, 'Coffee App');
  const project = projectOf(page);

  await projectName(page).click();
  await panel(page).getByRole('button', { name: 'Remove Ordering from the project' }).click();
  expect(await acceptDialog(page)).toContain('The project stays, with no maps, until someone deletes it.');
  await expect(tabs(page)).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/${a}$`));

  await page.goto(`/p/${project}`);
  expect(await acceptDialog(page)).toBe('Coffee App has no maps yet. Create a new map in it?');
  await expect(page).toHaveURL(new RegExp(`/p/${project}/[a-z0-9]+$`));
  await expect(projectName(page)).toHaveText('Coffee App');
  await expect(tabs(page)).toHaveText(['Untitled map']);
});

test('Delete project removes the project and leaves its maps alone', async ({ page, createMap, pullMap }) => {
  const [a, b] = [await createMap(map('Ordering')), await createMap(map('Loyalty'))];
  const before = [await pullContent(pullMap, a), await pullContent(pullMap, b)];
  await openMap(page, a, 2);
  await addByLink(page, b);
  const project = projectOf(page);

  await projectName(page).click();
  await panel(page).getByRole('button', { name: 'Delete project' }).click();
  expect(await acceptDialog(page)).toBe(`Delete the project "Untitled project"?\n\nThe maps in it aren't deleted, but the project link will no longer work.`);
  await expect(tabs(page)).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/${a}$`));
  await expect(page).not.toHaveURL(/\/p\//);
  await expect(page.locator('#projectAddBtn')).toHaveText('Start a project');
  expect([await pullContent(pullMap, a), await pullContent(pullMap, b)]).toEqual(before);

  await page.goto(`/p/${project}`);
  expect(await acceptDialog(page)).toContain('The project may have been deleted');
});

test('a new map is untitled in both its title and its tab', async ({ page, createMap }) => {
  await openMap(page, await createMap(map('Ordering')), 2);
  await startProject(page);
  await page.locator('#projectAddBtn').click();
  await panel(page).getByRole('button', { name: 'New map' }).click();
  await expect(tabs(page).nth(1)).toHaveText('Untitled map');
  await expect(page.locator('#boardName')).toHaveAttribute('placeholder', 'Untitled map');
});
