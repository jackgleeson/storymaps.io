import { test, expect, openMap, squashedSections } from './fixtures.js';

// Prompts point at the site the app is served from, so a self-hosted copy works the same
test('Build with AI links to the map on this site, not storymaps.io', async ({ page, createMap }) => {
  const id = await createMap();
  await openMap(page, id);
  const origin = new URL(page.url()).origin;
  await page.locator('#buildAiBtn').click();
  const prompt = page.locator('#buildAiPrompt');
  const pick = (target) => page.locator(`.build-ai-target[data-target="${target}"]`).click();

  // Claude Code, pulling the map with the CLI
  await pick('claude-code');
  await expect(prompt).toHaveValue(new RegExp(`^npx storymaps pull --force ${origin}/${id} && claude `));

  // Claude Code, reading the YAML directly. A terminal tool always fetches the map, so there is
  // no switch for putting the map in the command
  await page.locator('#buildAiCliToggleRow .build-ai-toggle-switch').click();
  await expect(page.locator('#buildAiCliToggle')).not.toBeChecked();
  await expect(prompt).toHaveValue(new RegExp(`The YAML at ${origin}/${id}\\.yaml describes`));
  await expect(page.locator('#buildAiFetchToggleRow')).toBeHidden();

  // An assistant that fetches the URL
  await pick('cursor');
  await expect(prompt).toHaveValue(new RegExp(`${origin}/${id}\\.yaml$`));

  expect(await prompt.inputValue()).not.toContain('storymaps.io');
});

test('Build with AI puts the map in the prompt as YAML when the assistant cannot fetch it', async ({ page, createMap }) => {
  const id = await createMap();
  await openMap(page, id);
  await page.locator('#buildAiBtn').click();
  const prompt = page.locator('#buildAiPrompt');

  // A chat app can't fetch, so the map comes after the instructions
  await page.locator('.build-ai-target[data-target="chatgpt"]').click();
  await expect(page.locator('#buildAiFetchToggleRow')).toBeHidden();
  await expect(prompt).toHaveValue(/^The YAML below describes/);
  await expect(prompt).toHaveValue(new RegExp(`\\nid: ${id}\\n`));
  await expect(prompt).toHaveValue(/\nsteps:\n/);

  // An assistant that can fetch can still be given the map in the prompt
  await page.locator('.build-ai-target[data-target="cursor"]').click();
  await page.locator('#buildAiFetchToggleRow .build-ai-toggle-switch').click();
  await expect(prompt).toHaveValue(/^The YAML below describes/);
  await expect(prompt).not.toHaveValue(/\.yaml$/);
});

test('Build with AI names an unnamed slice by position', async ({ page, createMap }) => {
  const id = await createMap(`name: Coffee app
steps:
  - Browse
  - Order
  - Pay
slices:
  - name: MVP
    stories:
      Browse:
        - name: One
          status: done
        - name: Two
  - name: ""
    stories:
      Pay:
        - name: Card payment
`);
  await openMap(page, id);
  await page.locator('#buildAiBtn').click();
  const prompt = page.locator('#buildAiPrompt');

  // The AI builds every card, done or not: it starts from nothing, and status on the map is for people to set
  await page.locator('.build-ai-target[data-target="claude-code"]').click();
  await expect(prompt).toHaveValue(/in the 'MVP' slice\."$/);

  // A slice with no name shows as "Slice 2" in the list, but the prompt points at it by position
  await page.locator('#buildAiSlice').selectOption('1');
  await expect(prompt).toHaveValue(/in slice 2 in the slices list \(it has no name\)\./);
  await expect(prompt).not.toHaveValue(/Slice 2/);
});

test('Build with AI shows every section in full in a short window', async ({ page, createMap }) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  await openMap(page, await createMap());
  await page.locator('#buildAiBtn').click();
  await page.locator('.build-ai-target[data-target="chatgpt"]').click();
  expect(await squashedSections(page)).toEqual([]);
});

test('Build with AI can add a slice to an existing app, for coding agents only', async ({ page, createMap }) => {
  const id = await createMap();
  await openMap(page, id);
  await page.locator('#buildAiBtn').click();
  const prompt = page.locator('#buildAiPrompt');
  const mode = page.locator('#buildAiModeSelect');
  const pick = (target) => page.locator(`.build-ai-target[data-target="${target}"]`).click();
  const existing = mode.locator('option[value="existing"]');

  // An app builder starts from nothing, and so does a chat
  await expect(existing).toHaveCount(0);
  await pick('claude');
  await expect(existing).toHaveCount(0);

  // A terminal agent gets it in the command
  await pick('claude-code');
  await mode.selectOption('existing');
  await expect(prompt).toHaveValue(/Your task: add the features listed in .* to the existing app in this project\./);
  await expect(prompt).not.toHaveValue(/build a full app/);

  // An editor agent gets it in the prompt, and keeps the mode when you change agent
  await pick('cursor');
  await expect(mode).toHaveValue('existing');
  await expect(prompt).toHaveValue(/to the existing app in this project\./);

  // Moving to a tool that can't use it goes back to a prototype
  await pick('lovable');
  await expect(existing).toHaveCount(0);
  await expect(mode).toHaveValue('prototype');
  await expect(prompt).toHaveValue(/build a functional prototype/);

  // The other modes read as before
  await pick('claude-code');
  await mode.selectOption('full');
  await expect(prompt).toHaveValue(/build a full app of the features listed/);
});

const COFFEE = `name: Coffee app
steps:
  - Browse
  - Add To Cart
  - Pay
slices:
  - name: MVP
    stories:
      Browse:
        - name: Drink list
  - name: V2
    stories:
      Add To Cart:
        - name: Group ordering
      Pay:
        - name: Split payment
        - name: Gift cards
`;

test('Build with AI builds one card picked from the Card list', async ({ page, createMap }) => {
  const id = await createMap(COFFEE);
  await openMap(page, id);
  await page.locator('#buildAiBtn').click();
  const prompt = page.locator('#buildAiPrompt');
  const cards = page.locator('#buildAiCard');

  // The list holds the cards of the slice picked, under their steps, and starts on the whole slice
  await expect(cards).toHaveValue('');
  await expect(cards.locator('option')).toHaveText(['All cards', 'Drink list']);
  await expect(prompt).toHaveValue(/of the features listed in the "MVP" slice\./);

  await page.locator('#buildAiSlice').selectOption({ label: 'V2' });
  await expect(cards.locator('option')).toHaveText(['All cards', 'Group ordering', 'Split payment', 'Gift cards']);
  await expect(cards.locator('optgroup')).toHaveCount(2);
  await expect(cards.locator('optgroup').first()).toHaveAttribute('label', 'Add To Cart');

  // The prompt names the card, its slice and its step, and still gives the whole story map
  await cards.selectOption({ label: 'Group ordering' });
  await expect(prompt).toHaveValue(/Your task: build a functional prototype of only the "Group ordering" card\. It is in the "V2" slice, under the "Add To Cart" step\. Use the rest of the story map to see where it fits\./);
  await expect(prompt).toHaveValue(new RegExp(`/${id}\\.yaml$`));

  // A coding agent can add the card to an app, with the names in single quotes for the terminal
  await page.locator('.build-ai-target[data-target="claude-code"]').click();
  await page.locator('#buildAiModeSelect').selectOption('existing');
  await expect(prompt).toHaveValue(/add only the 'Group ordering' card to the existing app in this project\. It is in the 'V2' slice, under the 'Add To Cart' step\..* Read the existing code first/);

  // Another slice goes back to all its cards, and every slice has no card to pick
  await page.locator('#buildAiSlice').selectOption({ label: 'MVP' });
  await expect(cards).toHaveValue('');
  await expect(prompt).toHaveValue(/the features listed in the 'MVP' slice/);
  await page.locator('#buildAiSlice').selectOption('all');
  await expect(cards).toBeDisabled();
});

test('Build with AI on a card menu opens the window on that card', async ({ page, createMap }) => {
  const id = await createMap(COFFEE);
  await openMap(page, id);
  const prompt = page.locator('#buildAiPrompt');

  // The right-click menu of a card in a slice
  const split = page.locator('.story-card[data-story-id]').filter({ has: page.locator('textarea.story-text') }).nth(2);
  const splitId = await split.getAttribute('data-story-id');
  const splitName = await split.locator('textarea.story-text').inputValue();
  await split.click({ button: 'right' });
  await page.getByRole('button', { name: 'Build with AI' }).click();
  await expect(page.locator('#buildAiModal')).toHaveClass(/visible/);
  await expect(page.locator('#buildAiSlice')).toHaveValue('1');
  await expect(page.locator('#buildAiCard')).toHaveValue(splitId);
  await expect(prompt).toHaveValue(new RegExp(`of only the "${splitName}" card\\. It is in the "V2" slice`));
  await page.locator('#buildAiModalClose').click();

  // The ... menu of a card has it too
  const first = page.locator('.story-card[data-story-id]').filter({ has: page.locator('textarea.story-text') }).first();
  await first.hover();
  await first.locator('.btn-options').click();
  await first.locator('.options-item', { hasText: 'Build with AI' }).evaluate(e => e.click());
  await expect(page.locator('#buildAiSlice')).toHaveValue('0');
  await expect(prompt).toHaveValue(/of only the "Drink list" card\. It is in the "MVP" slice, under the "Browse" step\./);
  await page.locator('#buildAiModalClose').click();
});
