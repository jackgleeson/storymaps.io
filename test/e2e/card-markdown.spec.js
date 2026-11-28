import { test, expect, openMap, description } from './fixtures.js';

const MAP = `name: Markdown
steps:
  - Search
slices:
  - name: MVP
    stories:
      Search:
        - name: Search the menu
          body: |-
            ## Problem
            A customer has **no quick way** to find a drink (see [COF-120](https://example.com/COF-120)).
            - [ ] Show a search box
            - Clear with \`Esc\`
`;

const open = async (page) => {
  const card = page.locator('.slice-container .story-card').first();
  await card.hover();
  await card.locator('.btn-expand').click();
  await expect(description(page)).toBeVisible();
};
const shown = (page) => description(page).evaluate(el => el.innerText);

test('a description shows its Markdown formatted, with the symbols hidden', async ({ page, createMap }) => {
  await openMap(page, await createMap(MAP), 1);
  await open(page);
  const text = await shown(page);
  expect(text).toContain('Problem');
  expect(text).not.toContain('##');
  expect(text).not.toContain('**');
  expect(text).not.toContain('https://example.com');
  expect(text).not.toContain('`');
  await expect(description(page).locator('.cm-md-bold')).toHaveText('no quick way');
  await expect(description(page).locator('.cm-md-heading')).toHaveText('Problem');
  await expect(description(page).locator('.cm-md-code')).toHaveText('Esc');
  // The task item shows a tick box in place of its bullet
  await expect(description(page).locator('.cm-md-bullet')).toHaveCount(1);
  await expect(description(page).locator('.cm-md-task')).toHaveCount(1);
});

test('a click on a formatted piece shows the Markdown of that piece only, and Esc formats it again', async ({ page, createMap }) => {
  await openMap(page, await createMap(MAP), 1);
  await open(page);
  await description(page).locator('.cm-md-bold').click();
  let text = await shown(page);
  expect(text).toContain('**no quick way**');
  expect(text).not.toContain('##');
  expect(text).not.toContain('https://example.com');

  await description(page).locator('.cm-md-heading').click();
  text = await shown(page);
  expect(text).toContain('## Problem');
  expect(text).not.toContain('**');

  // Esc leaves the details with the card still open, and a second Esc closes the card
  await page.keyboard.press('Escape');
  expect(await shown(page)).not.toContain('##');
  await expect(page.locator('#cardExpandModal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#cardExpandModal')).toBeHidden();
});

test('a click on a link opens it, and the pencil beside it shows its Markdown', async ({ page, createMap, context }) => {
  await openMap(page, await createMap(MAP), 1);
  await open(page);
  const [opened] = await Promise.all([context.waitForEvent('page'), description(page).locator('.cm-md-link').click()]);
  expect(opened.url()).toBe('https://example.com/COF-120');
  await opened.close();
  expect(await shown(page)).not.toContain('https://example.com');

  await description(page).locator('.cm-md-edit').click();
  expect(await shown(page)).toContain('[COF-120](https://example.com/COF-120)');
  await expect(description(page).locator('.cm-md-edit')).toHaveCount(0);
});

test('ticking a task box saves it, and a link pasted over words makes them a link', async ({ page, createMap, pullMap, context }) => {
  const id = await createMap(MAP);
  await openMap(page, id, 1);
  await open(page);
  await description(page).locator('.cm-md-task').click();
  await expect.poll(async () => (await pullMap(id)).slices[0].stories[0][0].body).toContain('- [x] Show a search box');

  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => navigator.clipboard.writeText('https://example.com/esc'));
  await description(page).locator('.cm-md-code').dblclick();
  await page.keyboard.press('Control+v');
  await expect.poll(async () => (await pullMap(id)).slices[0].stories[0][0].body).toContain('[Esc](https://example.com/esc)');
});

test('copying from a description puts the Markdown and a formatted copy on the clipboard', async ({ page, createMap, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openMap(page, await createMap(MAP), 1);
  await open(page);
  await description(page).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  const copied = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const read = async (type) => (await item.getType(type)).text();
    return { text: await read('text/plain'), html: await read('text/html') };
  });
  expect(copied.text).toContain('A customer has **no quick way** to find a drink');
  expect(copied.html).toContain('<h2>Problem</h2>');
  expect(copied.html).toContain('<strong>no quick way</strong>');
  expect(copied.html).toContain('<a href="https://example.com/COF-120">COF-120</a>');
  expect(copied.html).not.toContain('**');
});

test('Ctrl+B and the strike shortcut wrap the selection, taking in the whole of a link', async ({ page, createMap, pullMap }) => {
  const id = await createMap(MAP);
  await openMap(page, id, 1);
  await open(page);
  const body = async () => (await pullMap(id)).slices[0].stories[0][0].body;

  // Select just the words of the link: the strike goes round its address too
  await description(page).locator('.cm-md-edit').click();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Control+Shift+x');
  await expect.poll(body).toContain('(see ~~[COF-120](https://example.com/COF-120)~~).');
  await page.keyboard.press('Control+Shift+x');
  await expect.poll(body).toContain('(see [COF-120](https://example.com/COF-120)).');

  await description(page).locator('.cm-md-code').dblclick();
  await page.keyboard.press('Control+b');
  await expect.poll(body).toContain('- Clear with **`Esc`**');
});

test('strike symbols typed round the words of a link go round the whole link', async ({ page, createMap, pullMap }) => {
  const id = await createMap(MAP);
  await openMap(page, id, 1);
  await open(page);
  // The cursor goes in at the start of the link's words, then to just after the "]"
  await description(page).locator('.cm-md-edit').click();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('~~');
  for (let i = 0; i < 'COF-120]'.length + 1; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.type('~~');
  await expect.poll(async () => (await pullMap(id)).slices[0].stories[0][0].body)
    .toContain('(see ~~[COF-120](https://example.com/COF-120)~~).');
  await expect(description(page).locator('.cm-md-strike')).toHaveText(/COF-120/);
});

test('a block of code hides its backtick lines until the cursor is in the block', async ({ page, createMap }) => {
  const map = MAP.replace('            - Clear with `Esc`', '            - Clear with ```Esc```\n            ```\n            x = **1**\n            ```');
  await openMap(page, await createMap(map), 1);
  await open(page);
  // Three backticks in a sentence are code too, with no stray backticks left showing
  await expect(description(page).locator('.cm-md-code')).toHaveText('Esc');
  expect(await shown(page)).not.toContain('`');
  await expect(description(page).locator('.cm-md-codeblock')).toHaveText('x = **1**');
  await expect(description(page).locator('.cm-md-fence-hidden')).toHaveCount(2);

  await description(page).locator('.cm-md-codeblock').click();
  await expect(description(page).locator('.cm-md-fence-hidden')).toHaveCount(0);
  expect(await shown(page)).toContain('```');
});

test('HTML and script in a description show as plain text, and only web links can be opened', async ({ page, createMap }) => {
  const map = MAP.replace('            ## Problem', '            <img src=x onerror="window.hacked=1"> <script>window.hacked=1</script> [bad](javascript:window.hacked=1) [fine](https://example.com/ok)');
  await openMap(page, await createMap(map), 1);
  await open(page);
  // The editor draws tiny spacer images of its own beside widgets, which have no source
  await expect(description(page).locator('img[src], img[onerror], script, iframe')).toHaveCount(0);
  expect(await shown(page)).toContain('<img src=x onerror="window.hacked=1">');
  // The script link is drawn as a link and does nothing; the web link carries its address and shows it on hover
  await expect(description(page).locator('[data-url]')).toHaveCount(2);
  await expect(description(page).locator('.cm-md-link', { hasText: 'fine' })).toHaveAttribute('title', 'https://example.com/ok');
  await expect(description(page).locator('.cm-md-link', { hasText: 'bad' })).not.toHaveAttribute('data-url', /.*/);
  await description(page).locator('.cm-md-link', { hasText: 'bad' }).click();
  expect(await page.evaluate(() => window.hacked)).toBeUndefined();
});

test('a web address pasted on its own becomes a link waiting for its words', async ({ page, createMap, pullMap, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const id = await createMap(MAP);
  await openMap(page, id, 1);
  await open(page);
  const body = async () => (await pullMap(id)).slices[0].stories[0][0].body;
  await page.evaluate(() => navigator.clipboard.writeText('https://example.com/spec'));

  // The cursor lands between the square brackets, so typing names the link
  await description(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('See ');
  await page.keyboard.press('Control+v');
  await page.keyboard.type('the spec');
  await page.keyboard.press('Control+End');
  await expect.poll(body).toContain('See [the spec](https://example.com/spec)');
  // Once the cursor moves off the link, it shows as a link and opens on a click
  await page.keyboard.press('Enter');
  await expect(description(page).locator('.cm-md-link', { hasText: 'the spec' })).toHaveAttribute('data-url', 'https://example.com/spec');

  // Left with no words, it becomes the address on its own
  await page.keyboard.press('Control+v');
  await page.keyboard.press('Control+Home');
  await expect.poll(body).toMatch(/\n- https:\/\/example\.com\/spec$/);

  // In code it pastes as it is
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('`ab`');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Control+v');
  await expect.poll(body).toContain('`ahttps://example.com/specb`');
});

test('a typed tick box item keeps its dash until the box is finished', async ({ page, createMap }) => {
  await openMap(page, await createMap(MAP), 1);
  await open(page);
  await description(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  // The dash stays a dash while the item is being started, so the box can be typed after it
  for (const typed of ['- ', '[', ' ', ']']) {
    await page.keyboard.type(typed);
    await expect(description(page).locator('.cm-md-bullet')).toHaveCount(1);
    expect((await shown(page)).trimEnd().split('\n').pop().startsWith('-')).toBe(true);
  }
  await page.keyboard.type(' item');
  await expect(description(page).locator('.cm-md-task')).toHaveCount(2);
  await expect(description(page).locator('.cm-md-bullet')).toHaveCount(1);
  // A plain item gets its bullet at the first letter
  await page.keyboard.press('Enter');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('a');
  await expect(description(page).locator('.cm-md-bullet')).toHaveCount(2);
});

test('opening a card and clicking the end of a line leave the last link as a link', async ({ page, createMap }) => {
  const map = MAP.replace('- Clear with `Esc`', '- Clear with `Esc`\n\n            Tracked work is [here](https://example.com/work)');
  await openMap(page, await createMap(map), 1);
  await open(page);
  expect(await shown(page)).not.toContain('https://example.com/work');
  // A click to the right of the last line puts the cursor after the link, not in it
  const line = description(page).locator('.cm-line').last();
  const box = await line.boundingBox();
  await page.mouse.click(box.x + box.width - 20, box.y + box.height / 2);
  await expect(description(page)).toBeFocused();
  expect(await shown(page)).not.toContain('https://example.com/work');
  await page.keyboard.type(' now');
  expect(await shown(page)).toContain('here');
  expect((await shown(page)).trimEnd().endsWith('now')).toBe(true);
  // The pencil still shows its Markdown
  await description(page).locator('.cm-md-edit').last().click();
  expect(await shown(page)).toContain('[here](https://example.com/work)');
});

test('a card open when the story map is locked loses its template buttons and can no longer be typed in', async ({ page, createMap, request, pullMap }) => {
  const { createHash } = await import('node:crypto');
  const id = await createMap(MAP);
  await openMap(page, id, 1);
  await open(page);
  const chips = page.locator('#cardExpandChips');
  await expect(chips).toBeVisible();

  // Someone else locks the story map while the card is open
  const passwordHash = createHash('sha256').update('secret').digest('hex');
  expect((await request.post(`/api/lock/${id}`, { data: { passwordHash } })).status()).toBe(200);
  await expect(page.locator('body')).toHaveClass(/read-only-mode/, { timeout: 10000 });
  await expect(chips).toBeHidden();
  await expect(description(page)).toHaveAttribute('contenteditable', 'false');

  // A card opened straight from its link on the locked story map has none either
  const cardId = (await page.locator('.slice-container .story-card').first().getAttribute('data-story-id'));
  await page.goto('about:blank');
  await page.goto(`/${id}#card-${cardId}`);
  await expect(page.locator('#cardExpandModal')).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/read-only-mode/);
  await expect(chips).toBeHidden();
  const before = JSON.stringify((await pullMap(id)).slices);
  await chips.locator('button').first().evaluate(el => el.click());
  await page.waitForTimeout(500);
  expect(JSON.stringify((await pullMap(id)).slices)).toBe(before);
});
