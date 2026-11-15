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
  await expect(review.locator('.import-intro')).toHaveText('Found 2 epics and 4 issues in COFFEE. Each one becomes a card, in a slice called Imported, ready to arrange into steps and slices.');
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

  await review.locator('#jiraImportMode label', { hasText: 'Replace map' }).click();
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

// After any tracker import a guide lights one thing at a time, like the tour: the backbone
// first, then the cards.
const guide = (page) => page.locator('#tourTooltip');

test('after an import, a guide builds the backbone before any card is moved', async ({ page, createMap, pullMap }) => {
  const id = await createMap();
  await openMap(page, id);
  // The test browser starts with the tour marked as taken
  await page.evaluate(() => localStorage.removeItem('tourCompleted'));
  await importCsv(page, 'jira', 'jira', 'jira.csv', jiraCsv);
  await page.locator('#jiraImportStage2 #jiraImportMode label', { hasText: 'Replace map' }).click();
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
  await page.locator('#jiraImportStage2 #jiraImportMode label', { hasText: 'Replace map' }).click();
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
  expect(map.steps.slice(0, 2).map(step => step.name)).toEqual(['Browse', 'Pay']);
});
