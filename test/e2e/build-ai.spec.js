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
