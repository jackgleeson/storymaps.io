import { test, expect, openMap, acceptDialog } from './fixtures.js';

// Tracker imports: the review step lists one row per card, and the cards land in one slice
// called Imported. A group (an epic, a parent task) is a card in its own colour.

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
  await expect(review.locator('.import-intro')).toHaveText('Found 2 epics and 4 issues in COFFEE. Each one becomes a card, in one slice called Imported, ready to arrange into steps and slices.');
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
  expect(map.slices.map(slice => slice.name)).toEqual(['Imported']);
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
