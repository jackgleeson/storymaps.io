import { readFileSync } from 'node:fs';
import { test, expect, openMap, stepNames, cardNames, acceptDialog } from './fixtures.js';

const openSubmenu = async (page, triggerId, itemId) => {
  await page.locator('#menuBtn').click();
  await page.locator(`#${triggerId}`).click();
  await page.locator(`#${itemId}`).click();
};

test('Export as YAML shows the map', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  await openSubmenu(page, 'exportSubmenuTrigger', 'exportYamlBtn');
  const yaml = page.locator('#exportYamlText');
  await expect(yaml).toBeVisible();
  await expect(yaml).toHaveValue(/^name: Coffee app$/m);
  await expect(yaml).toHaveValue(/- Browse\n\s+- Order\n\s+- Pay/);
  await expect(yaml).toHaveValue(/name: Card payment/);
});

test('Export inside a project says which project, straight after the map ID', async ({ page, createMap, request }) => {
  const id = await createMap();
  const project = (await (await request.post('/api/projects', { data: { mapIds: [id], name: 'Cafe' }, headers: { origin: 'http://localhost' } })).json()).project.id;
  await page.goto(`/p/${project}/${id}`);
  await expect(page.locator('.story-card').first()).toBeVisible();
  await openSubmenu(page, 'exportSubmenuTrigger', 'exportYamlBtn');
  await expect(page.locator('#exportYamlText')).toHaveValue(new RegExp(`^name: Coffee app\nid: ${id}\nproject: ${project}\n`));
  // Opened by itself, the same map doesn't know about the project
  await openMap(page, id);
  await openSubmenu(page, 'exportSubmenuTrigger', 'exportYamlBtn');
  await expect(page.locator('#exportYamlText')).toHaveValue(new RegExp(`^name: Coffee app\nid: ${id}\nsite: `));
});

test('Import from YAML replaces the map and saves it', async ({ page, createMap, pullMap }) => {
  const id = await createMap();
  await openMap(page, id);
  await openSubmenu(page, 'importSubmenuTrigger', 'importYamlMenuItem');
  await page.locator('#importYamlText').fill('name: Imported\nsteps:\n  - Plan\n  - Build\nslices:\n  - name: MVP\n    stories:\n      Plan:\n        - name: Sketch\n');
  await page.locator('#importYamlBtn').click();
  await acceptDialog(page);

  await expect.poll(() => stepNames(page)).toEqual(['Plan', 'Build']);
  expect(await cardNames(page)).toEqual(['Sketch']);
  await expect.poll(async () => (await pullMap(id)).name).toBe('Imported');
});

test('Import from YAML lists validation errors without changing the map', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  await openSubmenu(page, 'importSubmenuTrigger', 'importYamlMenuItem');
  await page.locator('#importYamlText').fill('name: Broken\nsteps: []\n');
  await page.locator('#importYamlBtn').click();
  await expect(page.locator('#importYamlValidationError')).toHaveText('Missing or empty "steps" list');
  expect(await stepNames(page)).toEqual(['Browse', 'Order', 'Pay']);
});

// A server with IMPORT_EXPORT_ENABLED=false marks the page (checked in the integration tests).
// Mark it here the same way.
const serveWithIntegrationsOff = (page) => page.addInitScript(() => {
  document.addEventListener('DOMContentLoaded', () => { document.documentElement.dataset.integrations = 'off'; });
});

test('with tracker APIs turned off, the menus offer only the CSV options', async ({ page, createMap }) => {
  await serveWithIntegrationsOff(page);
  await openMap(page, await createMap());
  await page.locator('#menuBtn').click();

  await page.locator('#importSubmenuTrigger').click();
  await page.locator('#importSubmenu [data-integration="jira"]').click();
  await expect(page.locator('#importJiraCsvBtn')).toBeVisible();
  await expect(page.locator('#importJiraBtn')).toBeHidden();

  await page.locator('#exportSubmenuTrigger').click();
  await page.locator('#exportSubmenu [data-integration="asana"]').click();
  await expect(page.locator('#exportAsanaCsvBtn')).toBeVisible();
  await expect(page.locator('#exportAsanaProxyBtn')).toBeHidden();
  // Linear exports only through its API
  await expect(page.locator('#exportSubmenu [data-integration="linear"]')).toBeHidden();
  await expect(page.locator('#exportSubmenu [data-integration="jira"]')).toBeVisible();
});

test('with tracker APIs turned off, the welcome page imports from CSV', async ({ page }) => {
  await serveWithIntegrationsOff(page);
  await page.goto('/');
  await page.locator('.welcome-integration[data-import="jira"]').click();
  await expect(page.locator('#jiraImportTitle')).toHaveText('Import from Jira CSV');
});

test('with tracker APIs on, the welcome page imports through the API', async ({ page }) => {
  await page.goto('/');
  await page.locator('.welcome-integration[data-import="jira"]').click();
  await expect(page.locator('#jiraImportTitle')).toHaveText('Import from Jira');
});

const trackerMap = `name: Tracker export
steps:
  - Browse Menu
  - Pay
slices:
  - name: MVP
    stories:
      Browse Menu:
        - name: Drink list
          status: done
          tags: [frontend]
      Pay:
        - name: Card payment
          status: planned
        - name: Waiting on the bank
          status: blocked
`;

const openExport = async (page, integration, itemId) => {
  await page.locator('#menuBtn').click();
  await page.locator('#exportSubmenuTrigger').click();
  await page.locator(`#exportSubmenu [data-integration="${integration}"]`).click();
  await page.locator(`#${itemId}`).click();
};

test('Jira CSV export shows what a card becomes and downloads one Story per card with labels', async ({ page, createMap }) => {
  await openMap(page, await createMap(trackerMap), 2);
  await openExport(page, 'jira', 'exportJiraBtn');
  const modal = page.locator('#jiraExportModal');

  // One example: the first card, and the issue it becomes
  const issue = modal.locator('.export-example-issue');
  await expect(modal.locator('.export-example-card')).toContainText('Drink list');
  await expect(issue.locator('.export-example-type')).toHaveText('Story, status Done');
  await expect(issue.locator('.export-label')).toHaveText(['mvp', 'browse-menu', 'frontend']);
  await expect(issue.locator('.export-example-description')).toContainText('Slice: MVP');
  await expect(issue.locator('.export-example-description')).toContainText('Step: Browse Menu');
  await expect(issue.locator('.export-example-description a')).toHaveAttribute('href', /#card-/);
  await expect(modal.locator('[data-export="count"]')).toHaveText('3 stories');

  // Unticking a label takes it off the example
  await modal.locator('input[data-label="step"]').uncheck();
  await expect(issue.locator('.export-label')).toHaveText(['mvp', 'frontend']);
  await modal.locator('input[data-label="step"]').check();

  // The card list stays closed until it's opened
  const row = (name) => modal.locator('.export-card-row', { hasText: name });
  await expect(row('Card payment')).toBeHidden();
  await modal.locator('.export-disclosure-summary', { hasText: 'Choose cards' }).click();
  await expect(modal.locator('.export-disclosure-summary', { hasText: 'Choose cards' })).toContainText('(all 3 included)');
  await expect(row('Waiting on the bank').locator('.export-card-status')).toHaveText('To Do');
  await expect(row('Waiting on the bank').locator('.export-label')).toHaveText(['mvp', 'pay']);

  // The Jira status names can be changed
  await modal.locator('.export-disclosure-summary', { hasText: 'Jira status names' }).click();
  await page.locator('#jiraStatusBlocked').fill('On Hold');
  await expect(row('Waiting on the bank').locator('.export-card-status')).toHaveText('On Hold');

  // Unticking a card leaves it out
  await row('Card payment').locator('input').uncheck();
  await expect(modal.locator('[data-export="count"]')).toHaveText('2 stories');
  await expect(modal.locator('.export-disclosure-summary', { hasText: 'Choose cards' })).toContainText('(2 of 3 included)');

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#jiraExportDownload').click()]);
  expect(download.suggestedFilename()).toBe('tracker-export-jira.csv');
  const csv = readFileSync(await download.path(), 'utf-8');
  const lines = csv.split('\n');
  expect(lines[0]).toBe('Work type,Summary,Description,Status,Project type,Labels,Labels,Labels');
  expect(csv).toContain('Story,Drink list,');
  expect(csv).toContain(',Done,software,mvp,browse-menu,frontend');
  expect(csv).toContain(',On Hold,software,mvp,pay,');
  expect(csv).not.toContain('Card payment');
  expect(csv).not.toContain('Epic');
  await expect(modal).toBeHidden();
});

test('an export starts with only the task cards, and one tick brings the rest in', async ({ page }) => {
  // The coffee shop as it works today: 10 yellow cards, and 17 problems, opportunities and questions
  await page.goto('/sample/type-now');
  await expect(page.locator('#boardName')).toHaveValue('Coffee Shop Today');
  await page.evaluate(() => document.getElementById('exportJiraProxyBtn').click());
  const modal = page.locator('.modal-overlay.visible');
  const tasksOnly = modal.locator('[data-export="tasks-only"]');
  await expect(tasksOnly).toBeChecked();
  await expect(modal.locator('.export-tasks-only')).toContainText('Leaves out 17 cards');
  await expect(modal.locator('[data-export="count"]')).toHaveText('10 stories');

  await tasksOnly.uncheck();
  await expect(modal.locator('[data-export="count"]')).toHaveText('27 stories');
});

test('every tracker export lists blocked cards, and the Status filter can leave them out', async ({ page, createMap }) => {
  await openMap(page, await createMap(trackerMap), 2);
  const kinds = [
    ['jira', 'exportJiraProxyBtn', 'jiraProxyExportModal', 'To Do', '3 stories'],
    ['asana', 'exportAsanaCsvBtn', 'asanaCsvExportModal', 'Not completed', '3 tasks'],
    ['asana', 'exportAsanaProxyBtn', 'asanaProxyExportModal', 'Not completed', '3 tasks'],
    ['phabricator', 'exportPhabBtn', 'phabExportModal', 'Stalled', '3 tasks'],
    ['phabricator', 'exportPhabProxyBtn', 'phabProxyExportModal', 'Stalled', '3 tasks'],
    ['linear', 'exportLinearProxyBtn', 'linearProxyExportModal', 'Backlog', '3 issues'],
  ];
  for (const [integration, itemId, modalId, status, total] of kinds) {
    await openExport(page, integration, itemId);
    const modal = page.locator(`#${modalId}`);
    await expect(modal.locator('[data-export="count"]'), itemId).toHaveText(total);
    await modal.locator('.export-disclosure-summary', { hasText: 'Choose cards' }).click();
    const row = modal.locator('.export-card-row', { hasText: 'Waiting on the bank' });
    await expect(row.locator('.export-card-status'), itemId).toHaveText(status);
    await modal.locator('input[data-status="blocked"]').uncheck();
    await expect(row, itemId).toHaveCount(0);
    await expect(modal.locator('.export-card-row', { hasText: 'Card payment' })).toBeVisible();
    // Closing an export asks first, so start each one from a fresh page
    await page.reload();
    await page.locator('.slice-container').first().waitFor();
  }
});

test('Phabricator exports make no labels and write the slice, step and tags into the description', async ({ page, createMap }) => {
  await openMap(page, await createMap(trackerMap), 2);
  await openExport(page, 'phabricator', 'exportPhabBtn');
  const modal = page.locator('#phabExportModal');
  await expect(modal.locator('input[data-label]')).toHaveCount(0);
  await expect(modal.locator('.export-example-description')).toContainText('Tags: frontend');
  await modal.locator('[data-export="next"]').click();
  await page.locator('#phabTags').fill('Shop Team');
  const call = page.locator('#phabImportCall');
  await expect(call).toContainText('"title": "Drink list"');
  await expect(call).toContainText('"status": "resolved"');
  await expect(call).toContainText('Slice: MVP\\nStep: Browse Menu\\nTags: frontend');
  await expect(call).toContainText('["shop-team"]');
  await expect(page.locator('#phabImportFunction')).not.toContainText('subtask');
});

test('an API export sends one issue per card and ticks each one off', async ({ page, createMap }) => {
  await openMap(page, await createMap(trackerMap), 2);
  let sent;
  await page.route('**/api/export/linear', async (route) => {
    sent = route.request().postDataJSON();
    const events = [
      ['progress', { type: 'labels', status: 'creating', count: 4 }],
      ...sent.issues.flatMap((issue, i) => [
        ['progress', { type: 'issue', title: issue.title, status: 'creating' }],
        i === 1
          ? ['progress', { type: 'issue', title: issue.title, status: 'error', error: 'Title too long' }]
          : ['progress', { type: 'issue', title: issue.title, status: 'created', key: `ENG-${i + 1}`, url: `https://linear.app/x/ENG-${i + 1}` }],
      ]),
      ['done', { created: 2, failed: 1 }],
    ];
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('') });
  });
  await openExport(page, 'linear', 'exportLinearProxyBtn');
  const modal = page.locator('#linearProxyExportModal');
  await modal.locator('[data-export="next"]').click();
  await expect(modal.locator('[data-export="summary"]')).toHaveText('Exporting 3 issues');
  await page.locator('#linearProxyApiKey').fill('lin_api_x');
  await page.locator('#linearProxyTeamKey').fill('ENG');
  await page.locator('#linearProxyExportRun').click();

  await expect(modal.locator('.export-done-summary')).toContainText('2 issues created');
  await expect(modal.locator('.export-done-summary')).toContainText('1 failed');
  await expect(modal.locator('.export-progress-item.done')).toHaveCount(2);
  await expect(modal.locator('.export-progress-item.failed')).toContainText('Title too long');
  await expect(modal.locator('.export-progress-item.done a').first()).toHaveAttribute('href', 'https://linear.app/x/ENG-1');
  await expect(page.locator('#linearProxyExportRun')).toBeDisabled();

  expect(sent.teamKey).toBe('ENG');
  expect(sent.issues.map(i => [i.title, i.status, i.labels])).toEqual([
    ['Drink list', 'done', ['mvp', 'browse-menu', 'frontend']],
    ['Card payment', 'planned', ['mvp', 'pay']],
    ['Waiting on the bank', 'blocked', ['mvp', 'pay']],
  ]);
  expect(sent.issues[0].description).toMatch(/^Slice: MVP\nStep: Browse Menu\nStory map: http.*#card-/);
});
