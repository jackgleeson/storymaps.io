import { test, expect, openMap } from './fixtures.js';

const map = (name = 'Card links', card = 'Email form') => `name: ${name}
steps:
  - Sign up
  - Pay
slices:
  - name: MVP
    stories:
      Sign up:
        - name: ${card}
          body: Ask for an email and a password.
`;
const MAP = map();

const copiedLink = async (page) => {
  await expect(page.getByText('Link copied')).toBeVisible();
  return page.evaluate(() => navigator.clipboard.readText());
};

test('a card link copied from the right-click menu, the ... menu or the open card opens that card', async ({ page, context, createMap }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const id = await createMap(MAP);
  await openMap(page, id, 2);
  const origin = new URL(page.url()).origin;
  const emailForm = page.locator('.story-card[data-story-id]', { has: page.locator('textarea.story-text') }).first();

  await emailForm.click({ button: 'right' });
  await expect(page.locator('.canvas-context-menu button span').first()).toHaveText('Copy link to card');
  await page.getByRole('button', { name: 'Copy link to card' }).click();
  const link = await copiedLink(page);
  expect(link).toMatch(new RegExp(`^${origin}/${id}#card-[a-z0-9]{8}$`));

  await page.evaluate(() => navigator.clipboard.writeText(''));
  await emailForm.hover();
  await emailForm.locator('.btn-options').click();
  // The menu can run below the window, so click the item without scrolling to it
  await emailForm.locator('.options-item', { hasText: 'Copy link to card' }).evaluate(e => e.click());
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);

  // Opening the link opens the card, without the tip about moving around the map
  await page.goto('/');
  await page.goto(link);
  await expect(page.locator('#cardExpandModal')).toHaveClass(/visible/);
  await expect(page.locator('#cardExpandName')).toHaveValue('Email form');
  await page.waitForTimeout(1200);
  await expect(page.locator('#tutorialToast.visible')).toHaveCount(0);

  await page.evaluate(() => navigator.clipboard.writeText(''));
  await page.locator('#cardExpandCopyLink').click();
  expect(await copiedLink(page)).toBe(link);

  // Closing it takes the card off the URL, so a reload shows the map, and flashes the card
  await page.locator('#cardExpandModalClose').click();
  await expect(page).toHaveURL(`${origin}/${id}`);
  const cardId = link.match(/#card-([a-z0-9]+)$/)[1];
  await expect(page.locator(`.story-card[data-story-id="${cardId}"]`)).toHaveClass(/card-link-flash/);
  await expect(page.locator('.card-link-flash')).toHaveCount(0, { timeout: 3000 });

  // A card that's gone says so
  await page.goto('/');
  await page.goto(`/${id}#card-zzzzzzzz`);
  await expect(page.getByText('That card is no longer in this map')).toBeVisible();
});

test('a card link copied in a project keeps the project, and opens the card in the right map', async ({ page, context, createMap }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const [a, b] = [await createMap(map('Ordering', 'Pick a coffee')), await createMap(map('Loyalty', 'Collect a stamp'))];
  await openMap(page, a, 2);
  await page.locator('#projectAddBtn').click();
  await page.locator('#projectPanel').getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/p\/[a-z0-9]{8}\//);
  await page.locator('#projectAddBtn').click();
  await page.locator('#projectPanel').getByLabel('Or paste the link to a map you have').fill(`${new URL(page.url()).origin}/${b}`);
  await page.locator('#projectPanel').getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('#projectTabs .project-tab')).toHaveText(['Ordering', 'Loyalty']);
  const project = new URL(page.url()).pathname.match(/^\/p\/([a-z0-9]+)\//)[1];
  const origin = new URL(page.url()).origin;

  // Copy a card link from the second map
  await page.locator('#projectTabs .project-tab', { hasText: 'Loyalty' }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${project}/${b}$`));
  await page.locator('.story-card[data-story-id]', { has: page.locator('textarea.story-text') }).first().click({ button: 'right' });
  await page.getByRole('button', { name: 'Copy link to card' }).click();
  const link = await copiedLink(page);
  expect(link).toMatch(new RegExp(`^${origin}/p/${project}/${b}#card-[a-z0-9]{8}$`));

  // Opening it brings back the tabs, on that map, with the card open
  await page.goto('/');
  await page.goto(link);
  await expect(page.locator('#projectTabs .project-tab')).toHaveText(['Ordering', 'Loyalty']);
  await expect(page.locator('#cardExpandName')).toHaveValue('Collect a stamp');

  // Closing it leaves the project link to the map
  await page.locator('#cardExpandModalClose').click();
  await expect(page).toHaveURL(`${origin}/p/${project}/${b}`);
});
