import { test, expect, openMap } from './fixtures.js';

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

  // Claude Code, reading the JSON directly
  await page.locator('#buildAiCliToggleRow .build-ai-toggle-switch').click();
  await expect(page.locator('#buildAiCliToggle')).not.toBeChecked();
  await expect(prompt).toHaveValue(new RegExp(`The JSON at ${origin}/${id}\\.json describes`));

  // An assistant that fetches the URL
  await pick('cursor');
  await expect(prompt).toHaveValue(new RegExp(`${origin}/${id}\\.json$`));

  expect(await prompt.inputValue()).not.toContain('storymaps.io');
});
