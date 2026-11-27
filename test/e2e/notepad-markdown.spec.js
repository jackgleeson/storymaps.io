import { createHash } from 'node:crypto';
import { test, expect, openMap } from './fixtures.js';

const notes = (page) => page.locator('#notesEditor .cm-content');
const openNotes = async (page) => {
  await page.locator('#notesToggle').click();
  await expect(notes(page)).toBeVisible();
};
const shown = (page) => notes(page).evaluate(el => el.innerText);

test('the notepad shows Markdown formatted, and the symbols of the piece the cursor is on', async ({ page, createMap, pullMap }) => {
  const id = await createMap();
  await openMap(page, id);
  await openNotes(page);
  await notes(page).click();
  await page.keyboard.type('## Plan\nShip the **MVP** first, see https://example.com/plan\n- [ ] Book the retro');
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');

  await expect(notes(page).locator('.cm-md-bold')).toHaveText('MVP');
  await expect(notes(page).locator('.cm-md-task')).toHaveCount(1);
  await expect(notes(page).locator('.cm-md-link')).toHaveAttribute('data-url', 'https://example.com/plan');
  const text = await shown(page);
  expect(text).not.toContain('##');
  expect(text).not.toContain('**');

  // A heading stays the size of the text around it, so every line sits on its rule
  const sizes = await notes(page).evaluate(el => [el.querySelector('.cm-md-heading'), el.querySelector('.cm-line:not(.cm-md-heading)')].map(line => getComputedStyle(line).fontSize));
  expect(sizes[0]).toBe(sizes[1]);

  // Ticking the box saves the note as Markdown
  await notes(page).locator('.cm-md-task').click();
  await expect.poll(async () => (await pullMap(id)).notes).toBe('## Plan\nShip the **MVP** first, see https://example.com/plan\n- [x] Book the retro');

  await notes(page).locator('.cm-md-bold').click();
  expect(await shown(page)).toContain('**MVP**');
});

test('two people type in the notepad at once, each seeing it formatted', async ({ page, createMap, openSecondTab, pullMap }) => {
  const id = await createMap();
  await openMap(page, id);
  const other = await openSecondTab();
  await openMap(other, id);
  await openNotes(page);
  await openNotes(other);

  await notes(page).click();
  await page.keyboard.type('**From A**');
  await expect(notes(other).locator('.cm-md-bold')).toHaveText('From A');

  // The second person adds a line while the first still has the cursor in theirs
  await notes(other).click();
  await other.keyboard.press('Control+End');
  await other.keyboard.press('Enter');
  await other.keyboard.type('*From B*');
  await expect(notes(page).locator('.cm-md-italic')).toHaveText('From B');
  await expect.poll(async () => (await pullMap(id)).notes).toBe('**From A**\n*From B*');
  // Each sees symbols only where their own cursor is
  expect(await shown(page)).toContain('**From A**');
  expect(await shown(other)).not.toContain('**From A**');
});

test('a web address typed in the notepad opens on a click straight away, and its pencil starts a link for it', async ({ page, createMap, context, pullMap }) => {
  const id = await createMap();
  await openMap(page, id);
  await openNotes(page);
  await notes(page).click();
  // The cursor is still right after the address
  await page.keyboard.type('see https://example.com/now');
  const link = notes(page).locator('.cm-md-link');
  const [opened] = await Promise.all([context.waitForEvent('page'), link.click()]);
  expect(opened.url()).toBe('https://example.com/now');
  await opened.close();

  // With the cursor elsewhere the pencil shows. It makes a link with no words yet, cursor in the square brackets
  await page.keyboard.press('Home');
  await notes(page).locator('.cm-md-edit').click();
  await expect.poll(async () => (await pullMap(id)).notes).toBe('see [](https://example.com/now)');
  await expect(notes(page).locator('.cm-md-edit')).toHaveCount(0);
  // Left without words, it goes back to the address alone
  await page.keyboard.press('Home');
  await expect.poll(async () => (await shown(page)).trim()).toBe('see https://example.com/now');

  // With words typed, it stays a link
  await notes(page).locator('.cm-md-edit').click();
  await page.keyboard.type('the plan');
  await page.keyboard.press('Home');
  expect((await shown(page)).trim()).toBe('see the plan');
  await expect.poll(async () => (await pullMap(id)).notes).toBe('see [the plan](https://example.com/now)');
});

test('on a locked story map the notepad shows formatted and nothing in it can be changed', async ({ page, createMap, pullMap, request, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const id = await createMap();
  await openMap(page, id);
  await openNotes(page);
  await notes(page).click();
  await page.keyboard.type('- [ ] task with [a link](https://example.com/a)');
  await page.keyboard.press('Home');
  const saved = '- [ ] task with [a link](https://example.com/a)';
  await expect.poll(async () => (await pullMap(id)).notes).toBe(saved);

  const passwordHash = createHash('sha256').update('secret').digest('hex');
  expect((await request.post(`/api/lock/${id}`, { data: { passwordHash } })).status()).toBe(200);
  await page.reload();
  await expect(page.locator('.step')).toHaveCount(3);
  await openNotes(page);
  await expect(notes(page).locator('.cm-md-task')).toHaveCount(1);
  await expect(notes(page).locator('.cm-md-edit')).toHaveCount(0);

  // Ticking, typing, the shortcuts, cutting and pasting all leave the note as it was
  await notes(page).locator('.cm-md-task').click({ force: true });
  await notes(page).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Control+x');
  await page.evaluate(() => navigator.clipboard.writeText('https://example.com/evil'));
  await page.keyboard.press('Control+v');
  await page.keyboard.type('~~');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  expect((await pullMap(id)).notes).toBe(saved);
  expect(await notes(page).locator('.cm-md-task').isChecked()).toBe(false);
});

test('a block of code in the notepad takes no extra lines, and a long note formats only what is on screen', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  await openNotes(page);
  await notes(page).click();
  await page.keyboard.type('before\n```\ncode\n```\nafter');
  const lineHeights = () => notes(page).evaluate(el => [...el.querySelectorAll('.cm-line')].map(line => Math.round(line.getBoundingClientRect().height)));
  expect(await lineHeights()).toEqual([25, 0, 25, 0, 25]);
  // With the cursor in the block its backtick lines are whole lines again
  await notes(page).locator('.cm-md-codeblock').click();
  expect(await lineHeights()).toEqual([25, 25, 25, 25, 25]);

  // 2,000 formatted lines: only the ones near the window are worked out
  await notes(page).evaluate((el) => { el.focus(); document.execCommand('selectAll'); document.execCommand('insertText', false, '**bold** line\n'.repeat(2000)); });
  await page.keyboard.press('Control+Home');
  await expect(notes(page).locator('.cm-md-bold').first()).toBeVisible();
  expect(await notes(page).locator('.cm-md-bold').count()).toBeLessThan(300);
});
