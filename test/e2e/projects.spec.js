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

test('Copy this map puts the copy in the project, next to the original', async ({ page, createMap, pullMap }) => {
  const a = await createMap(map('Ordering'));
  const b = await createMap(map('Loyalty'));
  await openMap(page, a, 2);
  await addByLink(page, b);
  const project = projectOf(page);
  await expect(tabs(page)).toHaveText(['Ordering', 'Loyalty']);

  await openMenu(page, 'copyExistingBtn');
  expect(await acceptDialog(page)).toContain('added to Untitled project next to this map');
  await expect(page).toHaveURL(new RegExp(`/p/${project}/[a-z0-9]+$`));
  const copy = new URL(page.url()).pathname.split('/').pop();
  expect(copy).not.toBe(a);
  await expect(tabs(page)).toHaveText(['Ordering', 'Ordering (Copy)', 'Loyalty']);
  await expect(tabs(page).nth(1)).toHaveAttribute('aria-current', 'page');
  await expect.poll(async () => (await pullMap(copy)).slices?.[0]?.stories).toEqual((await pullMap(a)).slices[0].stories);

  // The other maps list it too, and back returns to the original
  await tabs(page).last().click();
  await expect(tabs(page)).toHaveText(['Ordering', 'Ordering (Copy)', 'Loyalty']);
  await page.goBack();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/p/${project}/${a}$`));
});

test('Copy this map on a plain map link makes a plain copy', async ({ page, createMap }) => {
  const a = await createMap(map('Ordering'));
  await openMap(page, a, 2);
  await startProject(page);
  await page.goto(`/${a}`);
  await expect(page.locator('.step')).toHaveCount(2);

  await openMenu(page, 'copyExistingBtn');
  const message = await acceptDialog(page);
  expect(message).toContain('A copy will be created with a new URL.');
  expect(message).not.toContain('project');
  await expect(page).toHaveURL(/\/[a-z0-9]+$/);
  await expect(page).not.toHaveURL(new RegExp(`/${a}$`));
  await expect(page).not.toHaveURL(/\/p\//);
  await expect(tabs(page)).toHaveCount(0);
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

test('a slice link copied in a project keeps the project, and a plain map copies a plain link', async ({ page, context, createMap }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const [a, b] = [await createMap(map('Ordering')), await createMap(map('Loyalty'))];
  await openMap(page, a, 2);
  await addByLink(page, b);
  const project = projectOf(page);
  const origin = new URL(page.url()).origin;

  const copySliceLink = async () => {
    await page.locator('.slice-container .btn-slice-menu').first().click();
    await page.getByText('Copy link to slice').click();
    await expect(page.getByText('Link copied')).toBeVisible();
    return page.evaluate(() => navigator.clipboard.readText());
  };

  const link = await copySliceLink();
  expect(link).toMatch(new RegExp(`^${origin}/p/${project}/${a}#slice-mvp-[a-z0-9]{8}$`));

  // Opening it brings back the tabs, at the slice
  await page.goto('/');
  await page.goto(link);
  await expect(tabs(page)).toHaveText(['Ordering', 'Loyalty']);
  await expect(page).toHaveURL(link);

  await openMap(page, a, 2);
  expect(await copySliceLink()).toMatch(new RegExp(`^${origin}/${a}#slice-mvp-[a-z0-9]{8}$`));

  // The name part is only for reading: a link from before a rename still opens the slice,
  // and so does a link from before the name part existed
  const id = link.match(/#slice-mvp-([a-z0-9]{8})$/)[1];
  for (const hash of [`#slice-launch-${id}`, `#slice-${id}`]) {
    await page.goto('/');
    await page.goto(`/${a}${hash}`);
    await expect(page.locator('.step')).toHaveCount(2);
    await page.waitForTimeout(800);
    await expect(page.getByText('That slice is no longer in this map')).toHaveCount(0);
  }
  await page.goto('/');
  await page.goto(`/${a}#slice-mvp-zzzzzzzz`);
  await expect(page.getByText('That slice is no longer in this map')).toBeVisible();
});

test('Share offers the project link first in a project, then this map in the project', async ({ page, context, createMap }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const [a, b] = [await createMap(map('Ordering')), await createMap(map('Loyalty'))];
  await openMap(page, a, 2);
  const origin = new URL(page.url()).origin;
  const share = page.locator('#shareMenu');
  const copied = () => page.evaluate(() => navigator.clipboard.readText());

  // A map in no project has the one link
  await page.locator('#shareBtn').click();
  await expect(share.locator('#shareProjectLink')).toBeHidden();
  await expect(share.locator('#shareCopyLink')).toHaveText('Share URL');
  await share.locator('#shareCopyLink').click();
  expect(await copied()).toBe(`${origin}/${a}`);

  await page.locator('#projectAddBtn').click();
  await panel(page).getByRole('button', { name: 'Create project' }).click();
  // The reminder to bookmark the project shows in place of the note on sharing it
  await expect(page.locator('#bookmarkNudge')).toContainText('Bookmark this project');
  await expect(page.locator('#appToast')).not.toContainText('Project created');
  await page.locator('#bookmarkNudge').getByRole('button', { name: 'Got it' }).click();
  await addByLink(page, b);
  const project = projectOf(page);

  await page.locator('#shareBtn').click();
  await expect(share.locator('.share-menu-item:visible')).toHaveText([
    'Share project link',
    'Share this map link',
    'Share as image',
    'Download image',
  ]);
  await share.locator('#shareProjectLink').click();
  await expect(share).toBeHidden();
  expect(await copied()).toBe(`${origin}/p/${project}`);

  await page.locator('#shareBtn').click();
  await share.locator('#shareCopyLink').click();
  expect(await copied()).toBe(`${origin}/p/${project}/${a}`);

  // The project box has the link too
  await projectName(page).click();
  await expect(panel(page).getByLabel('Project link')).toHaveValue(`${origin}/p/${project}`);
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await panel(page).getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
  expect(await copied()).toBe(`${origin}/p/${project}`);

  // The shared project link opens the first map, with every tab
  await page.goto(`/p/${project}`);
  await expect(page).toHaveURL(new RegExp(`/p/${project}/${a}$`));
  await expect(tabs(page)).toHaveText(['Ordering', 'Loyalty']);
});

test('arrows, the wheel and the current tab move along tabs that overflow the bar', async ({ page, request }) => {
  const ids = [];
  for (let i = 0; i < 12; i++) {
    const res = await request.post('/api/maps', {
      data: map(`A long map name number ${i + 1}`),
      headers: { 'Content-Type': 'text/yaml', 'X-Forwarded-For': `198.20.${i}.${Math.floor(Math.random() * 250)}` },
    });
    ids.push((await res.json()).id);
  }
  const res = await request.post('/api/projects', { data: { mapIds: ids, name: 'Many' }, headers: { origin: 'http://localhost' } });
  const project = (await res.json()).project.id;
  const strip = page.locator('#projectTabs');
  const left = page.locator('#projectScrollLeft');
  const right = page.locator('#projectScrollRight');
  const scrolled = () => strip.evaluate(el => el.scrollLeft);

  // At the first map, only the right arrow shows
  await page.goto(`/p/${project}/${ids[0]}`);
  await expect(tabs(page)).toHaveCount(12);
  await expect(right).toBeVisible();
  await expect(left).toBeHidden();

  await right.click();
  await expect.poll(scrolled).toBeGreaterThan(100);
  await expect(left).toBeVisible();
  await left.click();
  await expect.poll(scrolled).toBe(0);

  // An up-and-down wheel over the tabs moves along them
  const box = await strip.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 300);
  await expect.poll(scrolled).toBeGreaterThan(200);

  // Opening the last map brings its tab fully into view
  await page.goto(`/p/${project}/${ids[11]}`);
  await expect.poll(() => page.evaluate(() => {
    const s = document.getElementById('projectTabs').getBoundingClientRect();
    const t = document.querySelector('.project-tab.current').getBoundingClientRect();
    return t.left >= s.left - 1 && t.right <= s.right + 1;
  })).toBe(true);
  await expect(left).toBeVisible();
  await expect(right).toBeHidden();
});
