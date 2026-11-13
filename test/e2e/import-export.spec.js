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

test('tracker exports include blocked cards, and the Status filter can leave them out', async ({ page, createMap }) => {
  await openMap(page, await createMap(`name: Blocked
steps:
  - Pay
slices:
  - name: MVP
    stories:
      Pay:
        - name: Card payment
          status: planned
        - name: Waiting on the bank
          status: blocked
`), 1);
  const open = async (integration, itemId) => {
    await page.locator('#menuBtn').click();
    await page.locator('#exportSubmenuTrigger').click();
    await page.locator(`#exportSubmenu [data-integration="${integration}"]`).click();
    await page.locator(`#${itemId}`).click();
  };

  // Jira CSV: the card is listed with the Jira status that Blocked maps to
  await open('jira', 'exportJiraBtn');
  const jiraTask = page.locator('.jira-export-task', { hasText: 'Waiting on the bank' });
  await expect(jiraTask.locator('.jira-export-task-status')).toHaveText('To Do');
  await page.locator('#jiraStatusBlocked').fill('On Hold');
  await expect(jiraTask.locator('.jira-export-task-status')).toHaveText('On Hold');
  await page.locator('#jiraFilterBlocked').uncheck();
  await expect(jiraTask).toHaveCount(0);
  await expect(page.locator('.jira-export-task', { hasText: 'Card payment' })).toBeVisible();
  // Closing an export asks first, so start each one from a fresh page
  await page.reload();
  await page.locator('.slice-container').first().waitFor();

  // The other trackers list it too, marked Blocked
  for (const [integration, itemId] of [['jira', 'exportJiraProxyBtn'], ['asana', 'exportAsanaCsvBtn'], ['asana', 'exportAsanaProxyBtn'], ['phabricator', 'exportPhabBtn'], ['phabricator', 'exportPhabProxyBtn'], ['linear', 'exportLinearProxyBtn']]) {
    await open(integration, itemId);
    const task = page.locator('.export-task:visible', { hasText: 'Waiting on the bank' });
    await expect(task.locator('.export-task-status'), itemId).toHaveText('Blocked');
    await page.reload();
    await page.locator('.slice-container').first().waitFor();
  }
});
