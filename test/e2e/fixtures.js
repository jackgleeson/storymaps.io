import { test as base, expect } from '@playwright/test';

export { expect };

export const DEFAULT_MAP = `name: Coffee app
steps:
  - Browse
  - Order
  - Pay
slices:
  - name: MVP
    stories:
      Browse:
        - name: One
        - name: Two
        - name: Three
      Order:
        - name: Pick size
      Pay:
        - name: Card payment
`;

// Skip the name prompt and the tour, which would otherwise cover the map
const skipFirstVisit = () => {
  localStorage.setItem('presenceName', 'Tester');
  localStorage.setItem('tourCompleted', 'true');
};

// A made-up client address, so each test has its own rate-limit allowance on the server
const clientAddress = () => ({ 'X-Forwarded-For': `198.18.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}` });

export const test = base.extend({
  extraHTTPHeaders: async ({}, use) => {
    await use(clientAddress());
  },

  page: async ({ page }, use) => {
    await page.addInitScript(skipFirstVisit);
    await use(page);
  },

  // Make a map through the API, the way the CLI does, and return its ID
  createMap: async ({ request }, use) => {
    await use(async (yaml = DEFAULT_MAP) => {
      const res = await request.post('/api/maps', { data: yaml, headers: { 'Content-Type': 'text/yaml' } });
      expect(res.status()).toBe(201);
      return (await res.json()).id;
    });
  },

  // A second person: a separate browser context, so a separate session
  openSecondTab: async ({ browser }, use) => {
    const contexts = [];
    await use(async () => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, extraHTTPHeaders: clientAddress() });
      contexts.push(context);
      const page = await context.newPage();
      await page.addInitScript(skipFirstVisit);
      return page;
    });
    await Promise.all(contexts.map(c => c.close()));
  },

  // The map as the server has it, for checking what was saved
  pullMap: async ({ request }, use) => {
    await use(async (id) => (await request.get(`/api/maps/${id}`)).json());
  },
});

// Open a map and wait until its steps are on the page
export const openMap = async (page, id, stepCount = 3) => {
  await page.goto(`/${id}`);
  await expect(page.locator('.step')).toHaveCount(stepCount);
};

export const stepNames = (page) => page.locator('.step .step-text').evaluateAll(els => els.map(e => e.value));

// Card names in one cell: the first slice, by column
export const cardNames = (page, column = 0) =>
  page.locator('.slice-container').first().locator('.story-column').nth(column)
    .locator('.story-card textarea').evaluateAll(els => els.map(e => e.value));

// Answer the app's own confirm or alert dialog with OK, and return its message
export const acceptDialog = async (page) => {
  const dialog = page.locator('.dialog-modal');
  await expect(dialog).toBeVisible();
  const message = await page.locator('.dialog-message').innerText();
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  return message;
};

export const undo = async (page) => {
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Control+z');
};

export const openMenu = async (page, itemId) => {
  await page.locator('#menuBtn').click();
  await page.locator(`#${itemId}`).click();
};

// Add a card to a cell of the first slice. The new card opens in the expanded view to be named.
export const addCard = async (page, name, column = 0) => {
  await page.locator('.slice-container').first().locator('.story-column').nth(column).locator('.btn-add-story').click();
  await expect(page.locator('#cardExpandModal')).toBeVisible();
  await page.keyboard.type(name);
  await page.keyboard.press('Escape');
  await expect(page.locator('#cardExpandModal')).toBeHidden();
};
