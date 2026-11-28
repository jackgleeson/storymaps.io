import { test, expect, openMap, acceptDialog, stepNames as stepNamesOf } from './fixtures.js';

// Tracker imports: the review step lists one row per card, and the cards land in a slice
// called Imported, under an empty slice with no name. A group (an epic, a parent task) is a card in its own colour.

const LIME = 'rgb(190, 242, 100)';
const YELLOW = 'rgb(254, 240, 138)';

// Every card in the slices with its colour, read left to right
const cardColours = (page) => page.locator('.slice-container .story-card').evaluateAll(cards =>
  cards.map(card => [card.querySelector('textarea').value, getComputedStyle(card).backgroundColor]));

const importCsv = async (page, tracker, prefix, name, lines) => {
  await page.locator('#menuBtn').click();
  await page.locator('#importSubmenuTrigger').click();
  await page.locator(`#importSubmenu [data-integration="${tracker}"]`).click();
  await page.locator(`#import${prefix[0].toUpperCase()}${prefix.slice(1)}CsvBtn`).click();
  await page.locator(`#${prefix}CsvFileInput`).setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(lines.join('\n')) });
  await page.locator(`#${prefix}CsvImportParseBtn`).click();
};

const jiraCsv = [
  'Summary,Issue key,Issue Type,Status,Parent key,Labels',
  '"Ordering: browse the menu, customise a drink and build an order",COFFEE-3,Epic,In Progress,,',
  'Drink list with prices,COFFEE-12,Story,Done,COFFEE-3,frontend',
  'Photo on each drink,COFFEE-21,Task,To Do,COFFEE-3,',
  'Payments,COFFEE-4,Epic,To Do,,',
  'Gift cards,COFFEE-47,Story,To Do,COFFEE-4,',
  'Alert sound for new orders?,COFFEE-60,Bug,To Do,,',
];

test('Jira import reviews epics and issues in one list and brings epics in as coloured cards', async ({ page, createMap, pullMap }) => {
  const id = await createMap();
  await openMap(page, id);
  await importCsv(page, 'jira', 'jira', 'jira.csv', jiraCsv);

  const review = page.locator('#jiraImportStage2');
  await expect(review.locator('.import-intro')).toHaveText('Found 2 epics and 4 issues in COFFEE. Each one becomes a card, ready to arrange into steps and slices.');
  await expect(page.locator('#jiraImportCount')).toHaveText('Importing 6 cards: 2 epics and 4 issues');

  // Epics first, each followed by its issues; issues with no epic come last, with no tag
  const rows = review.locator('.import-row:not(.import-row-head)');
  await expect(rows.locator('.import-row-key')).toHaveText(['COFFEE-3', 'COFFEE-12', 'COFFEE-21', 'COFFEE-4', 'COFFEE-47', 'COFFEE-60']);
  await expect(review.locator('.import-row-group .import-row-name')).toHaveText(['Ordering: browse the menu, customise a drink and build an order', 'Payments']);
  await expect(rows.nth(1).locator('.import-tag')).toHaveText('COFFEE-3');
  await expect(rows.nth(5).locator('.import-tag')).toHaveCount(0);
  // An issue sits indented under its epic; one with no epic lines up with the epics
  const left = async (row) => (await row.locator('.import-row-swatch').boundingBox()).x;
  expect(await left(rows.nth(1))).toBeGreaterThan(await left(rows.nth(0)));
  expect(await left(rows.nth(5))).toBe(await left(rows.nth(0)));
  await expect(rows.nth(0).locator('.import-row-status')).toHaveText('In Progress');
  await expect(rows.nth(2).locator('.import-row-status')).toHaveText('To Do');

  // The type filter leaves a kind of issue out
  await expect(review.locator('input[data-type]')).toHaveCount(4);
  await review.locator('input[data-type="Bug"]').uncheck();
  await expect(page.locator('#jiraImportCount')).toHaveText('Importing 5 cards: 2 epics and 3 issues');
  // Unticking an epic leaves its issues out too
  await rows.nth(3).locator('input').uncheck();
  await expect(rows.nth(4).locator('input')).not.toBeChecked();
  await expect(page.locator('#jiraImportCount')).toHaveText('Importing 3 cards: 1 epic and 2 issues');

  // The story map has steps, so the question says the cards go under them, and the button says what it will do
  await expect(review.locator('.import-mode-legend')).toHaveText('Where should the cards go?');
  await expect(review.locator('#jiraImportMode input[value="append"]')).toBeChecked();
  await expect(review.locator('#jiraImportMode [data-mode-detail="append"]')).toContainText('under the steps you already have');
  await expect(page.locator('#jiraImportConfirmBtn')).toHaveText('Add to story map');
  await review.locator('#jiraImportMode label', { hasText: 'Replace this story map' }).click();
  await expect(page.locator('#jiraImportConfirmBtn')).toHaveText('Replace story map');
  await page.locator('#jiraImportConfirmBtn').click();
  await acceptDialog(page);

  // The epic card is first, in its own colour, then its issues in the default colour
  await expect.poll(() => cardColours(page)).toEqual([
    ['Ordering: browse the menu, customise a drink and build an order', LIME],
    ['Drink list with prices', YELLOW],
    ['Photo on each drink', YELLOW],
  ]);
  const map = await pullMap(id);
  // The slice above the pile has no name: the first release is theirs to name
  expect(map.slices.map(slice => slice.name)).toEqual(['', 'Imported']);
  expect(map.slices[0].stories.flat()).toEqual([]);
  expect(map.legend.map(entry => entry.label)).toEqual(['Epic', 'Issue']);
  const text = JSON.stringify(map);
  expect(text).toContain('"tags":["COFFEE-3","frontend"]');
  expect(text).not.toContain('Payments');
  expect(text).not.toContain('Alert sound');
  expect(text).not.toContain('epic-01');
});

// A tree query exported from Azure DevOps: the Title column says how deep each work item sits
const azureCsv = [
  'ID,Work Item Type,Title 1,Title 2,Title 3,State,Tags',
  '3,Epic,Ordering,,,Active,',
  '12,User Story,,Drink list with prices,,Closed,frontend',
  '31,Task,,,Price the drinks,New,',
  '21,Feature,,Photos,,New,',
  '60,Bug,Alert sound for new orders?,,,New,',
  '61,User Story,Old idea,,,Removed,',
];

test('Azure DevOps CSV import puts work items under their epic and links the cards back', async ({ page, createMap, pullMap }) => {
  const id = await createMap();
  await openMap(page, id);
  await page.locator('#menuBtn').click();
  await page.locator('#importSubmenuTrigger').click();
  await page.locator('#importSubmenu [data-integration="azure-devops"]').click();
  await page.locator('#importAzureCsvBtn').click();
  await expect(page.locator('#azureImportTitle')).toHaveText('Import from Azure DevOps CSV');
  await page.locator('#azureCsvFileInput').setInputFiles({ name: 'azure.csv', mimeType: 'text/csv', buffer: Buffer.from(azureCsv.join('\n')) });
  await page.locator('#azureCsvOrganization').fill('dev.azure.com/acme');
  await page.locator('#azureCsvProject').fill('Coffee');
  await page.locator('#azureCsvImportParseBtn').click();

  // The task under a story and the removed story are left out
  const review = page.locator('#azureImportStage2');
  await expect(review.locator('.import-intro')).toHaveText('Found 1 epic and 3 work items in Coffee. Each one becomes a card, ready to arrange into steps and slices.');
  await expect(page.locator('#azureImportCount')).toHaveText('Importing 4 cards: 1 epic and 3 work items');
  const rows = review.locator('.import-row:not(.import-row-head)');
  await expect(rows.locator('.import-row-name')).toHaveText(['Ordering', 'Drink list with prices', 'Photos', 'Alert sound for new orders?']);
  await expect(rows.locator('.import-row-key')).toHaveText(['', '12', '21', '60']);
  await expect(rows.nth(1).locator('.import-tag')).toHaveText('epic-01');
  await expect(rows.nth(3).locator('.import-tag')).toHaveCount(0);
  await expect(rows.locator('.import-row-status')).toHaveText(['Active', 'Closed', 'New', 'New']);
  await expect(review.locator('.export-section-title').first()).toHaveText('Work item type');
  await expect(review.locator('input[data-type]')).toHaveCount(4);

  await review.locator('#azureImportMode label', { hasText: 'Replace this story map' }).click();
  await page.locator('#azureImportConfirmBtn').click();
  await acceptDialog(page);

  await expect.poll(() => cardColours(page)).toEqual([
    ['Ordering', LIME],
    ['Drink list with prices', YELLOW],
    ['Photos', YELLOW],
    ['Alert sound for new orders?', YELLOW],
  ]);
  const map = await pullMap(id);
  expect(map.name).toBe('Coffee Import');
  expect(map.legend.map(entry => entry.label)).toEqual(['Epic', 'Work item']);
  const text = JSON.stringify(map);
  expect(text).toContain('"tags":["epic-01","frontend"]');
  expect(text).toContain('https://dev.azure.com/acme/Coffee/_workitems/edit/12');
  expect(text).not.toContain('Price the drinks');
  expect(text).not.toContain('Old idea');
});

test('the Azure DevOps API import fetches the work items of a project and reviews them', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  let sent;
  await page.route('**/api/import/azure-devops', async (route) => {
    sent = route.request().postDataJSON();
    const items = [
      { id: 3, title: 'Ordering', type: 'Epic', state: 'Active', status: 'in-progress', description: '<div>Browse &amp; order</div>', tags: [] },
      { id: 12, title: 'Drink list with prices', type: 'Product Backlog Item', state: 'Done', status: 'done', tags: ['frontend'], points: 3, parentId: 3 },
    ];
    const events = [['progress', { phase: 'items', fetched: 2, total: 2 }], ['done', { organization: 'acme', project: 'Coffee', items, itemCount: 2 }]];
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('') });
  });
  await page.locator('#menuBtn').click();
  await page.locator('#importSubmenuTrigger').click();
  await page.locator('#importSubmenu [data-integration="azure-devops"]').click();
  await page.locator('#importAzureBtn').click();
  await page.locator('#azureImportFetchBtn').click();
  await expect(page.locator('#azureImportVerifyStatus')).toHaveText('Please fill in all fields');
  await page.locator('#azureImportOrganization').fill('acme.visualstudio.com');
  await page.locator('#azureImportProject').fill('Coffee');
  await page.locator('#azureImportToken').fill('pat-secret');
  await page.locator('#azureImportFetchBtn').click();

  await expect(page.locator('#azureImportStage2 .import-intro')).toContainText('Found 1 epic and 1 work item in Coffee.');
  await expect(page.locator('#azureImportStage2 .import-points-badge')).toHaveText('3 pts');
  expect(sent).toEqual({ organization: 'acme', project: 'Coffee', token: 'pat-secret' });
  // The organization and the project are remembered, in every Azure DevOps window. The token is not.
  // The link typed in was tidied to the name of the organization when the field was left.
  await expect(page.locator('#azureImportOrganization')).toHaveValue('acme');
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('trackerDetails')))).toEqual({ 'azure.organization': 'acme', 'azure.project': 'Coffee' });
  await expect(page.locator('#azureProxyProject')).toHaveValue('Coffee');
  await expect(page.locator('#azureCsvOrganization')).toHaveValue('acme');
});

test('Phabricator CSV import makes one card per task and no blank group cards', async ({ page, createMap, pullMap }) => {
  const id = await createMap();
  await openMap(page, id);
  await importCsv(page, 'phabricator', 'phab', 'phab.csv', [
    'ID,Monogram,Title,Description,Status,Points,URI',
    '101,T101,Login,,Open,2,https://phabricator.example.org/T101',
    '102,T102,Logout,,In Progress,,https://phabricator.example.org/T102',
    '103,T103,Old task,,Resolved,,https://phabricator.example.org/T103',
  ]);
  const review = page.locator('#phabImportStage2');
  await expect(review.locator('.import-intro')).toContainText('Found 3 tasks in Phabricator');
  await expect(review.locator('.import-row-group')).toHaveCount(0);
  // Resolved tasks start unticked
  await expect(review.locator('input[data-status="done"]')).not.toBeChecked();
  await expect(page.locator('#phabImportCount')).toHaveText('Importing 2 cards');

  await page.locator('#phabImportConfirmBtn').click();
  // Added to the open map, beside the cards it already had
  await expect.poll(async () => (await cardColours(page)).filter(([name]) => ['Login', 'Logout'].includes(name))).toEqual([['Login', YELLOW], ['Logout', YELLOW]]);
  const map = JSON.stringify(await pullMap(id));
  expect(map).toContain('"name":"Imported"');
  expect(map).not.toContain('#bef264');
  expect(map).not.toContain('Old task');
  expect(map).not.toContain('legend');
});

test('Asana import treats a task with subtasks as a group and leaves the others loose', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  await importCsv(page, 'asana', 'asana', 'asana.csv', [
    'Task ID,Name,Section/Column,Completed At,Notes,Parent Task',
    '1,Checkout,,,Paying,',
    '2,Card payment,,,,Checkout',
    '3,Search,,,,',
  ]);
  const review = page.locator('#asanaImportStage2');
  await expect(review.locator('.import-intro')).toContainText('Found 1 parent task and 2 tasks');
  const rows = review.locator('.import-row:not(.import-row-head)');
  await expect(rows.locator('.import-row-name')).toHaveText(['Checkout', 'Card payment', 'Search']);
  await expect(rows.locator('.import-tag')).toHaveText(['parent-01', 'parent-01']);
  await expect(page.locator('#asanaImportCount')).toHaveText('Importing 3 cards: 1 parent task and 2 tasks');
});

test('tracker details are remembered in the browser for next time, but never the API token', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  await page.locator('#menuBtn').click();
  await page.locator('#importSubmenuTrigger').click();
  await page.locator('#importSubmenu [data-integration="jira"]').click();
  await page.locator('#importJiraBtn').click();
  await page.locator('#jiraImportInstanceUrl').fill('acme.atlassian.net');
  await page.locator('#jiraImportProjectKey').fill('SHOP');
  await page.locator('#jiraImportEmail').fill('me@example.com');
  await page.locator('#jiraImportToken').fill('secret-token');

  const saved = await page.evaluate(() => localStorage.getItem('trackerDetails'));
  expect(JSON.parse(saved)).toEqual({ 'jira.instanceUrl': 'acme.atlassian.net', 'jira.projectKey': 'SHOP', 'jira.email': 'me@example.com' });
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('secret-token');

  // After a reload the details are back, in the import and the export windows, and the token is not
  await page.reload();
  await page.locator('.slice-container').first().waitFor();
  await expect(page.locator('#jiraImportInstanceUrl')).toHaveValue('acme.atlassian.net');
  await expect(page.locator('#jiraImportProjectKey')).toHaveValue('SHOP');
  await expect(page.locator('#jiraImportEmail')).toHaveValue('me@example.com');
  await expect(page.locator('#jiraImportToken')).toHaveValue('');
  await expect(page.locator('#jiraProxyInstanceUrl')).toHaveValue('acme.atlassian.net');
  await expect(page.locator('#jiraProxyEmail')).toHaveValue('me@example.com');
  await expect(page.locator('#jiraCsvInstanceUrl')).toHaveValue('acme.atlassian.net');
  await expect(page.locator('#jiraProxyToken')).toHaveValue('');

  // Emptying a field forgets it
  await page.locator('#menuBtn').click();
  await page.locator('#importSubmenuTrigger').click();
  await page.locator('#importSubmenu [data-integration="jira"]').click();
  await page.locator('#importJiraBtn').click();
  await page.locator('#jiraImportEmail').fill('');
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('trackerDetails')))).toEqual({ 'jira.instanceUrl': 'acme.atlassian.net', 'jira.projectKey': 'SHOP' });
});

test('a Phabricator project link in the site field is split into the site and its tag', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  await page.locator('#menuBtn').click();
  await page.locator('#importSubmenuTrigger').click();
  await page.locator('#importSubmenu [data-integration="phabricator"]').click();
  await page.locator('#importPhabBtn').click();
  await page.locator('#phabImportProjectTags').fill('other-tag');

  // Pasted
  await page.locator('#phabImportInstanceUrl').focus();
  await page.evaluate(() => {
    const field = document.getElementById('phabImportInstanceUrl');
    field.value = 'https://phabricator.example.org/tag/my-project/';
    field.dispatchEvent(new Event('paste', { bubbles: true }));
  });
  await expect(page.locator('#phabImportInstanceUrl')).toHaveValue('https://phabricator.example.org');
  await expect(page.locator('#phabImportProjectTags')).toHaveValue('other-tag, my-project');

  // Typed, then left: the same tag is not added twice
  await page.locator('#phabImportInstanceUrl').fill('phabricator.example.org/tag/my-project');
  await page.locator('#phabImportToken').focus();
  await expect(page.locator('#phabImportInstanceUrl')).toHaveValue('phabricator.example.org');
  await expect(page.locator('#phabImportProjectTags')).toHaveValue('other-tag, my-project');

  // Remembered, and shown in the export window too
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('trackerDetails')))).toEqual({ 'phabricator.instanceUrl': 'phabricator.example.org', 'phabricator.tags': 'other-tag, my-project' });
  await expect(page.locator('#phabProxyTags')).toHaveValue('other-tag, my-project');
});

// After any tracker import a guide lights one thing at a time, like the tour: the backbone
// first, then the cards.
const guide = (page) => page.locator('#tourTooltip');

test('after an import, a guide builds the backbone before any card is moved', async ({ page, createMap, pullMap }) => {
  const id = await createMap();
  await openMap(page, id);
  // The test browser starts with the tour marked as taken
  await page.evaluate(() => localStorage.removeItem('tourCompleted'));
  await importCsv(page, 'jira', 'jira', 'jira.csv', jiraCsv);
  await page.locator('#jiraImportStage2 #jiraImportMode label', { hasText: 'Replace this story map' }).click();
  await page.locator('#jiraImportConfirmBtn').click();
  await acceptDialog(page);

  // Who it's for: the red card is lit and ready to type in
  await expect(guide(page).locator('.tour-tooltip-title')).toHaveText('Who is it for?');
  await expect(guide(page).locator('.tour-tooltip-body')).toContainText('Your 6 imported cards are safe in the Imported slice');
  const docsLink = guide(page).locator('.tour-tooltip-body a', { hasText: 'catch up here' });
  await expect(docsLink).toHaveAttribute('href', '/docs/define-the-story-map-backbone');
  await expect(docsLink).toHaveAttribute('target', '_blank');
  await expect(guide(page).locator('.tour-progress-dot')).toHaveCount(4);
  await expect(page.locator('.users-row .story-card .story-text').first()).toBeFocused();
  // The tooltip sits to the right of the lit card, clear of the rows below it
  const cardBox = await page.locator('.users-row .story-card').first().boundingBox();
  const tipBox = await guide(page).boundingBox();
  expect(tipBox.x).toBeGreaterThanOrEqual(cardBox.x + cardBox.width);
  // The cards are big enough to type on, however small the import was fitted
  expect(parseInt(await page.locator('#zoomReset').textContent(), 10)).toBeGreaterThanOrEqual(85);
  // The card menus, the selection bar and the side panel stay out of the way
  await page.locator('.steps-row .step').nth(1).click({ modifiers: ['Shift'], position: { x: 6, y: 20 }, force: true });
  await expect(page.locator('.selection-toolbar')).toBeHidden();
  await expect(page.locator('.steps-row .step .btn-options').first()).toBeHidden();
  await page.locator('.users-row .story-card').first().hover();
  await expect(page.locator('.users-row .story-card .btn-expand').first()).toBeHidden();
  await page.locator('.users-row .story-card').first().dblclick({ position: { x: 6, y: 6 }, force: true });
  await expect(page.locator('#cardExpandModal')).toBeHidden();
  await expect(page.locator('.panel-tabs')).toBeHidden();
  // The zoom buttons stay in reach, and the highlight follows the card when the zoom changes
  const before = await page.locator('#tourSpotlight').boundingBox();
  await page.locator('#zoomIn').click();
  await expect.poll(async () => (await page.locator('#tourSpotlight').boundingBox()).width).toBeGreaterThan(before.width);
  const lit = await page.locator('#tourSpotlight').boundingBox();
  const card = await page.locator('.users-row .story-card').first().boundingBox();
  expect(Math.abs(lit.x + lit.width / 2 - (card.x + card.width / 2))).toBeLessThan(3);
  await page.locator('.users-row .story-card .story-text').first().click();
  await page.keyboard.type('Customer');
  await page.keyboard.press('Enter');

  await expect(guide(page).locator('.tour-tooltip-title')).toHaveText('What are they trying to do?');
  await expect(page.locator('.activities-row .story-card .story-text').first()).toBeFocused();
  await page.keyboard.type('Order a coffee');
  await page.keyboard.press('Enter');

  // The steps: Enter moves along the row, and the arrow keys stay with the text
  await expect(guide(page).locator('.tour-tooltip-title')).toHaveText('What steps do they take?');
  const steps = page.locator('.steps-row .step:not(.phantom-step)');
  await expect(steps).toHaveCount(6);
  await page.keyboard.type('Browse menu');
  await page.keyboard.press('ArrowLeft');
  await expect(guide(page).locator('.tour-tooltip-title')).toHaveText('What steps do they take?');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Pay');
  await page.keyboard.press('Enter');
  // Enter on an empty step means the journey is done. The steps left blank are taken away,
  // and the pile is dealt again under the two that were named.
  await page.keyboard.press('Enter');

  // The last step dims nothing: the cards can be opened, selected and dragged
  await expect(guide(page).locator('.tour-tooltip-title')).toHaveText('Now place the cards');
  await expect(guide(page).locator('.tour-btn-next')).toHaveText(/Got it/);
  await expect(steps).toHaveCount(2);
  await expect(page.locator('#tourBackdrop')).toBeHidden();
  await expect(page.locator('.panel-tabs')).toBeVisible();
  const firstCard = page.locator('.slice-container .story-card').first();
  await firstCard.hover();
  await firstCard.locator('.btn-expand').click();
  await expect(page.locator('#cardExpandModal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#cardExpandModal')).toBeHidden();
  await expect(guide(page)).toBeVisible();
  await guide(page).locator('.tour-btn-next').click();
  await expect(guide(page)).toBeHidden();

  expect(await stepNamesOf(page)).toEqual(['Browse menu', 'Pay']);
  await expect.poll(async () => (await pullMap(id)).steps.map(step => step.name)).toEqual(['Browse menu', 'Pay']);
  const map = await pullMap(id);
  expect(map.users.flat().map(card => card.name)).toEqual(['Customer']);
  expect(map.activities.flat().map(card => card.name)).toEqual(['Order a coffee']);
  // All six cards are still in the pile, three under each step
  expect(map.slices.find(slice => slice.name === 'Imported').stories.map(cards => cards.length)).toEqual([3, 3]);
  // It is not the tour, so it doesn't count as having taken it
  expect(await page.evaluate(() => localStorage.getItem('tourCompleted'))).toBeNull();
});

test('the guide adds a step when Enter is pressed after the last one', async ({ page, createMap, pullMap }) => {
  const id = await createMap();
  await openMap(page, id);
  await importCsv(page, 'jira', 'jira', 'jira.csv', jiraCsv);
  await page.locator('#jiraImportStage2 #jiraImportMode label', { hasText: 'Replace this story map' }).click();
  await page.locator('#jiraImportConfirmBtn').click();
  await acceptDialog(page);
  await expect(guide(page).locator('.tour-tooltip-title')).toHaveText('Who is it for?');
  await guide(page).locator('.tour-btn-next').click();
  await guide(page).locator('.tour-btn-next').click();
  await expect(guide(page).locator('.tour-tooltip-title')).toHaveText('What steps do they take?');
  // Six cards made six steps. Naming a seventh and an eighth adds them.
  const names = ['Browse', 'Customise', 'Add to cart', 'Pay', 'Confirm', 'Collect', 'Rate', 'Reorder'];
  for (const name of names) {
    await page.keyboard.type(name);
    await page.keyboard.press('Enter');
  }
  await expect(page.locator('.steps-row .step:not(.phantom-step)')).toHaveCount(9);
  await page.keyboard.press('Enter');
  await expect(guide(page).locator('.tour-tooltip-title')).toHaveText('Now place the cards');
  await expect.poll(async () => (await pullMap(id)).steps.map(step => step.name)).toEqual(names);
});

test('a new story map nobody has worked on is filled by the import, with no question about adding or replacing', async ({ page, pullMap }) => {
  await page.goto('/');
  await page.locator('#welcomeNewBtn').click();
  await expect(page.locator('.step')).toHaveCount(1);
  const id = new URL(page.url()).pathname.slice(1);
  await importCsv(page, 'jira', 'jira', 'jira.csv', jiraCsv);

  const review = page.locator('#jiraImportStage2');
  await expect(review.locator('#jiraImportMode')).toBeHidden();
  await expect(review.locator('.import-intro')).toContainText('in a slice called Imported');
  await expect(page.locator('#jiraImportConfirmBtn')).toHaveText('Import to Map');
  await page.locator('#jiraImportConfirmBtn').click();

  // Nothing is asked: there was nothing on the story map to lose. The starter cards are gone.
  await expect(guide(page).locator('.tour-tooltip-title')).toHaveText('Who is it for?');
  await expect.poll(async () => (await pullMap(id)).slices.map(slice => slice.name)).toEqual(['', 'Imported']);
  expect(JSON.stringify(await pullMap(id))).not.toContain('New Task');
});

test('cards on a story map with no named steps go beside what is there, and the question says so', async ({ page, createMap }) => {
  const id = await createMap(`name: Loose cards
steps:
  - ""
slices:
  - name: Later
    stories:
      "":
        - name: An earlier card
`);
  await openMap(page, id, 1);
  await importCsv(page, 'jira', 'jira', 'jira.csv', jiraCsv);
  const mode = page.locator('#jiraImportStage2 #jiraImportMode');
  await expect(mode).toBeVisible();
  await expect(mode.locator('[data-mode-detail="append"]')).toContainText('beside what is already there');
});

test('added to a story map that has a backbone, the guide goes straight to the cards and the legend gains the epic colour', async ({ page, createMap, pullMap }) => {
  const id = await createMap(`name: Has a backbone
users:
  - name: Customer
    step: Browse
activities:
  - name: Order
    step: Browse
steps:
  - Browse
  - Pay
slices:
  - name: MVP
    stories:
      Browse:
        - name: Drink list
`);
  await openMap(page, id, 2);
  await importCsv(page, 'jira', 'jira', 'jira.csv', jiraCsv);
  await page.locator('#jiraImportConfirmBtn').click();

  await expect(guide(page).locator('.tour-tooltip-title')).toHaveText('Now place the cards');
  await expect(guide(page).locator('.tour-tooltip-body')).toContainText('The backbone is already here');
  await expect(guide(page).locator('.tour-progress-dot')).toHaveCount(1);
  // Nothing is dimmed on this step, and the keys belong to the app: Escape leaves the guide open
  await expect(page.locator('#tourBackdrop')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(guide(page)).toBeVisible();
  await guide(page).locator('.tour-btn-next').click();
  await expect(guide(page)).toBeHidden();

  await expect.poll(async () => (await pullMap(id)).slices.map(slice => slice.name)).toEqual(['MVP', 'Imported']);
  const map = await pullMap(id);
  expect(map.legend).toEqual([{ color: '#bef264', label: 'Epic' }]);
  // The cards went under the two steps that were there, dealt out from the left in the order
  // they came in. No step, user or activity was added.
  expect(map.steps.map(step => step.name)).toEqual(['Browse', 'Pay']);
  expect(map.users.flat().map(user => user.name)).toEqual(['Customer']);
  expect(map.slices[1].stories.map(cards => cards.map(card => card.name))).toEqual([
    ['Ordering: browse the menu, customise a drink and build an order', 'Photo on each drink', 'Gift cards'],
    ['Drink list with prices', 'Payments', 'Alert sound for new orders?'],
  ]);
});

// A big import: three epics, and 1,100 issues of three types, 400 of them done
const bigJiraCsv = () => {
  const lines = ['Summary,Issue key,Issue Type,Status,Parent key,Labels', 'Menu,BIG-1,Epic,To Do,,', 'Basket,BIG-2,Epic,To Do,,', 'Payments,BIG-3,Epic,To Do,,'];
  let key = 10;
  const add = (type, status, count) => {
    for (let i = 0; i < count; i++) lines.push(`${type} ${key},BIG-${key},${type},${status},BIG-${1 + (key++ % 3)},`);
  };
  add('Story', 'Done', 300);
  add('Story', 'To Do', 300);
  add('Bug', 'Done', 100);
  add('Bug', 'To Do', 200);
  add('Sub-task', 'To Do', 200);
  return lines;
};

test('an import of more than 1,000 cards warns, and a quick trim brings it under', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  await importCsv(page, 'jira', 'jira', 'big.csv', bigJiraCsv());

  const review = page.locator('#jiraImportStage2');
  const warning = review.locator('.import-big-warning');
  const count = page.locator('#jiraImportCount');
  const button = page.locator('#jiraImportConfirmBtn');
  const trims = review.locator('.import-trim');
  await expect(warning).toBeVisible();
  await expect(warning).toHaveText("1,103 cards is a lot for one story map. More than 1,000 cards on one story map could result in performance issues and make it hard to find your way around. Untick what you don't need, or import one project at a time.");
  await expect(count).toHaveText('Importing 1,103 cards: 3 epics and 1,100 issues');
  await expect(count).toHaveClass(/import-count-big/);
  await expect(review.locator('.import-intro')).toContainText('Found 3 epics and 1,100 issues in BIG.');
  // The button says how many cards it will add
  await expect(button).toHaveText('Add 1,103 cards');

  // The trims: the done ones, then the issue types, smallest first, never the most common one
  await expect(trims).toHaveText(['Leave out Done-400', 'Leave out Sub-tasks-200', 'Leave out Bugs-300']);
  // The status boxes say how many each holds
  await expect(review.locator('label:has(input[data-status="done"])')).toHaveText('Done(400)');

  // One press leaves the sub-tasks out, and that is enough here
  await trims.nth(1).click();
  await expect(count).toHaveText('Importing 903 cards: 3 epics and 900 issues');
  await expect(warning).toBeHidden();
  await expect(button).toHaveText('Add to story map');
  await expect(trims.nth(1)).toHaveText('Sub-tasks left out');
  await expect(trims.nth(1)).toHaveAttribute('aria-pressed', 'true');
  // It is the same as unticking the type below it
  await expect(review.locator('input[data-type="Sub-task"]')).not.toBeChecked();

  // Pressing it again brings them back, and the warning with them
  await trims.nth(1).click();
  await expect(count).toHaveText('Importing 1,103 cards: 3 epics and 1,100 issues');
  await expect(warning).toBeVisible();

  // A trim says what it would take off what is ticked now: 100 of the 300 bugs are done
  await trims.nth(0).click();
  await expect(count).toHaveText('Importing 703 cards: 3 epics and 700 issues');
  await expect(trims).toHaveText(['Done left out', 'Leave out Sub-tasks-200', 'Leave out Bugs-200']);

  // Replacing the story map is named on the button too, once it is big again
  await trims.nth(0).click();
  await review.locator('input[value="replace"]').check();
  await expect(button).toHaveText('Replace with 1,103 cards');
});

test('an import of 1,000 cards or fewer has no warning and no quick trims', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  await importCsv(page, 'jira', 'jira', 'jira.csv', jiraCsv);
  const review = page.locator('#jiraImportStage2');
  await expect(review.locator('.import-row')).not.toHaveCount(0);
  await expect(review.locator('.import-big-warning')).toBeHidden();
  await expect(review.locator('.import-trim')).toHaveCount(0);
  await expect(page.locator('#jiraImportConfirmBtn')).toHaveText('Add to story map');
});

test('a big import whose done tasks start unticked shows the trims only once it is over 1,000', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  const lines = ['ID,Monogram,Title,Description,Status,Points,URI'];
  for (let i = 0; i < 600; i++) lines.push(`${i},T${i},Open task ${i},,Open,,`);
  for (let i = 600; i < 1050; i++) lines.push(`${i},T${i},Old task ${i},,Resolved,,`);
  await importCsv(page, 'phabricator', 'phab', 'phab.csv', lines);

  // Phabricator leaves resolved tasks out to begin with, so only 600 of the 1,050 are ticked
  const review = page.locator('#phabImportStage2');
  const trims = review.locator('.import-trim');
  await expect(page.locator('#phabImportCount')).toHaveText('Importing 600 cards');
  await expect(review.locator('.import-big-warning')).toBeHidden();
  await expect(trims).toBeHidden();

  // Ticking them goes over, and the warning and the trim come into view
  await review.locator('input[data-status="done"]').check();
  await expect(page.locator('#phabImportCount')).toHaveText('Importing 1,050 cards');
  await expect(review.locator('.import-big-warning')).toBeVisible();
  await expect(trims).toHaveText(['Leave out Done-450']);

  // The trim stays once it has done its job, so it can be taken back
  await trims.first().click();
  await expect(page.locator('#phabImportCount')).toHaveText('Importing 600 cards');
  await expect(review.locator('.import-big-warning')).toBeHidden();
  await expect(trims).toHaveText(['Done left out']);
});

// Labels: Jira repeats the Labels column once for each label an issue has
const labelledCsv = [
  'Summary,Issue key,Issue Type,Status,Parent key,Labels,Labels',
  'Menu,LAB-1,Epic,To Do,,,',
  'Old menu page,LAB-2,Story,To Do,LAB-1,legacy,',
  'Menu on a phone,LAB-3,Story,To Do,LAB-1,mobile,',
  'Old phone menu,LAB-4,Story,To Do,LAB-1,legacy,mobile',
  'Try a new layout,LAB-5,Task,To Do,LAB-1,spike,',
  'Prices,LAB-6,Story,To Do,LAB-1,,',
];

test('unticking a label leaves out every card that has it, and the left-out labels show beside the list', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  await importCsv(page, 'jira', 'jira', 'labels.csv', labelledCsv);
  const review = page.locator('#jiraImportStage2');
  const count = page.locator('#jiraImportCount');
  const toggle = review.locator('.import-labels-toggle');
  const panel = review.locator('.import-labels-panel');
  const option = (name) => panel.locator('.import-labels-option', { hasText: name });
  const ticked = () => review.locator('.import-row:not(.import-row-head)').evaluateAll(rows =>
    rows.filter(r => r.querySelector('input').checked).map(r => r.querySelector('.import-row-key').textContent));

  await expect(toggle).toHaveText('3 of 3 labels');
  await expect(panel).toBeHidden();
  await toggle.click();
  // Most used first, then by name, with how many cards carry each, and the cards with no label last
  await expect(panel.locator('.import-labels-option')).toHaveText(['legacy2', 'mobile2', 'spike1', 'No label2']);

  // A card with two labels is left out when either of them is
  await option('legacy').locator('input').uncheck();
  await expect(count).toHaveText('Importing 4 cards: 1 epic and 3 issues');
  expect(await ticked()).toEqual(['LAB-1', 'LAB-3', 'LAB-5', 'LAB-6']);
  await expect(toggle).toHaveText('2 of 3 labels');
  await expect(option('legacy')).toHaveText('legacy-2');
  await expect(review.locator('.import-labels-pill')).toHaveText(['legacy×']);
  await expect(review.locator('.import-labels-left-out .import-trim-count')).toHaveText('-2');
  // The rows left out say which label did it
  await expect(review.locator('.import-row-left-label')).toHaveText(['legacy', 'legacy']);

  // With mobile out as well, bringing legacy back leaves the card with both labels out
  await option('mobile').locator('input').uncheck();
  await option('legacy').locator('input').check();
  expect(await ticked()).toEqual(['LAB-1', 'LAB-2', 'LAB-5', 'LAB-6']);
  await expect(review.locator('.import-row-left-label')).toHaveText(['mobile', 'mobile']);

  // Finding a label narrows the list
  await panel.locator('.import-labels-find').fill('spi');
  await expect(panel.locator('.import-labels-option:visible')).toHaveText(['spike1']);
  await panel.locator('.import-labels-find').fill('');

  // Escape closes the list and leaves the import open
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(review).toBeVisible();

  // The cross on a pill brings its cards back
  await review.locator('.import-labels-pill button').click();
  await expect(count).toHaveText('Importing 6 cards: 1 epic and 5 issues');
  await expect(review.locator('.import-labels-pill')).toHaveCount(0);

  // Untick all, then tick one, keeps only that label
  await toggle.click();
  await panel.getByRole('button', { name: 'Untick all' }).click();
  await expect(count).toHaveText('Importing 0 cards');
  await option('spike').locator('input').check();
  expect(await ticked()).toEqual(['LAB-5']);
  await panel.getByRole('button', { name: 'Tick all', exact: true }).click();
  await expect(count).toHaveText('Importing 6 cards: 1 epic and 5 issues');
  // Clicking away closes the list
  await review.locator('.import-intro').click();
  await expect(panel).toBeHidden();
});

test('an import with no labels has no labels list', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  await importCsv(page, 'phabricator', 'phab', 'phab.csv', ['ID,Monogram,Title,Description,Status,Points,URI', '101,T101,Login,,Open,2,']);
  await expect(page.locator('#phabImportStage2 .import-row')).not.toHaveCount(0);
  await expect(page.locator('#phabImportStage2 .import-labels')).toHaveCount(0);
});
