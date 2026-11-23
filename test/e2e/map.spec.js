import { test, expect, openMap, stepNames, cardNames, addCard } from './fixtures.js';

test('opens a map and shows its steps and cards', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  await expect(page.locator('#boardName')).toHaveValue('Coffee app');
  expect(await stepNames(page)).toEqual(['Browse', 'Order', 'Pay']);
  expect(await cardNames(page)).toEqual(['One', 'Two', 'Three']);
});

test('a card added in the browser is saved', async ({ page, createMap, pullMap }) => {
  const id = await createMap();
  await openMap(page, id);
  await addCard(page, 'Oat milk', 1);
  await expect.poll(async () => (await pullMap(id)).slices[0].stories[1].map(c => c.name)).toEqual(['Pick size', 'Oat milk']);

  await page.reload();
  await expect.poll(() => cardNames(page, 1)).toEqual(['Pick size', 'Oat milk']);
});

test('the welcome page opens and a new map can be started from it', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toHaveClass(/welcome-visible/);
  await page.locator('#welcomeNewBtn').click();
  await expect(page).toHaveURL(/\/[0-9a-z]{8}$/);
  await expect(page.locator('.step')).not.toHaveCount(0);
});

test('the map header fits between a phone and a laptop, with the menu button in view', async ({ page, createMap }) => {
  const id = await createMap();
  for (const width of [620, 760, 880]) {
    await page.setViewportSize({ width, height: 700 });
    await openMap(page, id);
    const right = await page.locator('#menuBtn').evaluate(b => b.getBoundingClientRect().right);
    expect(right).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  }
});

// The room above the map: the whole window when the map fits, a small strip when it doesn't
const mapOfSlices = (count) => `name: Heights
steps:
  - One
  - Two
slices:
${Array.from({ length: count }, (_, i) => `  - name: Slice ${i}
    stories:
      One:
        - name: Card A${i}
        - name: Card B${i}
`).join('')}`;

const scrollToTop = async (page) => {
  await page.locator('#storyMapWrapper').evaluate(w => { w.scrollTop = 0; });
  await page.evaluate(() => new Promise(requestAnimationFrame));
};

const mapEdges = (page) => page.evaluate(() => {
  const wrapper = document.getElementById('storyMapWrapper');
  const map = document.getElementById('storyMap');
  const area = wrapper.getBoundingClientRect();
  return {
    top: map.getBoundingClientRect().top - area.top,
    bottom: map.querySelector(':scope > .map-body').getBoundingClientRect().bottom - area.top,
    height: wrapper.clientHeight,
  };
});

test('scrolling up stops just above a map taller than the window', async ({ page, createMap }) => {
  await openMap(page, await createMap(mapOfSlices(12)), 2);
  await scrollToTop(page);
  const { top, bottom, height } = await mapEdges(page);
  expect(bottom).toBeGreaterThan(height);
  expect(top).toBeGreaterThanOrEqual(0);
  expect(top).toBeLessThanOrEqual(21);
});

test('scrolling up stops just above a map that fits in the window too, so no big gap opens under the header', async ({ page, createMap }) => {
  await openMap(page, await createMap(mapOfSlices(1)), 2);
  await scrollToTop(page);
  const { top, bottom, height } = await mapEdges(page);
  expect(bottom).toBeLessThan(height);
  expect(top).toBeGreaterThanOrEqual(0);
  expect(top).toBeLessThanOrEqual(21);
});

test('zoomed out, a map that fits in the window can move to its bottom edge, but no further', async ({ page, createMap }) => {
  await openMap(page, await createMap(mapOfSlices(1)), 2);
  await page.locator('#zoomOut').click();
  await scrollToTop(page);
  const { top, bottom, height } = await mapEdges(page);
  expect(top).toBeGreaterThan(21);
  expect(Math.abs(bottom - height)).toBeLessThanOrEqual(2);
});

test('zooming out a tall map frees the room above it and keeps the middle of the view still', async ({ page, createMap }) => {
  await openMap(page, await createMap(mapOfSlices(12)), 2);
  const wrapper = page.locator('#storyMapWrapper');
  await wrapper.evaluate((w) => {
    w.scrollTop = document.getElementById('storyMap').offsetTop + 300;
  });
  const middle = () => page.evaluate(() => {
    const w = document.getElementById('storyMapWrapper');
    const map = document.getElementById('storyMap');
    const zoom = parseFloat(map.style.getPropertyValue('--zoom')) || 1;
    return (w.getBoundingClientRect().top + w.clientHeight / 2 - map.getBoundingClientRect().top) / zoom;
  });
  const before = await middle();
  await page.locator('#zoomOut').click();
  expect(Math.abs(await middle() - before)).toBeLessThanOrEqual(3);

  for (let i = 0; i < 8; i++) await page.locator('#zoomOut').click();
  await scrollToTop(page);
  const { top, bottom, height } = await mapEdges(page);
  expect(bottom).toBeLessThanOrEqual(height + 2);
  expect(top).toBeGreaterThan(21);
});

test('zooming back in to normal size loses the extra room above a map that fits', async ({ page, createMap }) => {
  await openMap(page, await createMap(mapOfSlices(1)), 2);
  await page.locator('#zoomOut').click();
  await scrollToTop(page);
  expect((await mapEdges(page)).top).toBeGreaterThan(21);

  await page.locator('#zoomIn').click();
  await scrollToTop(page);
  expect((await mapEdges(page)).top).toBeLessThanOrEqual(21);
});

test('Tab moves from one step to the next, left to right, without stopping on its buttons', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  const steps = page.locator('.step .step-text');
  await steps.nth(0).click();
  for (const next of [1, 2]) {
    await page.keyboard.press('Tab');
    await expect(steps.nth(next)).toBeFocused();
  }
});

test('a one-line title sits in the middle of its card at tablet width', async ({ page, createMap }) => {
  // At this width a title is 12px with a 16.8px line, and its height measures as 17. Rounding the
  // line down first made one line count as two, so the title sat in the top half of the card.
  await page.setViewportSize({ width: 800, height: 1280 });
  await openMap(page, await createMap());
  const card = page.locator('.slice-container .story-card').first();
  const title = card.locator('textarea.story-text');
  await title.fill('Pay');
  await expect(title).toHaveJSProperty('rows', 1);
  const gap = await card.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const text = el.querySelector('textarea').getBoundingClientRect();
    return Math.abs((text.top - box.top) - (box.bottom - text.bottom));
  });
  expect(gap).toBeLessThanOrEqual(2);
});

test('the full screen button goes out when the browser leaves full screen and refuses to go back', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  const button = page.locator('#toggleFullscreenBtn');
  await button.click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await expect(button).toHaveClass(/active/);

  // The browser ends full screen itself, and turns down the request to go back in, as it does
  // when there was no click or key press
  await page.evaluate(async () => {
    Element.prototype.requestFullscreen = () => Promise.reject(new TypeError('not allowed'));
    await document.exitFullscreen();
  });
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await expect(button).not.toHaveClass(/active/);
  await expect(button).toHaveAttribute('title', 'Full screen');
});

test('a blank cell in the users, activities or steps row says what a click adds', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  const label = (cell) => cell.evaluate((el) => getComputedStyle(el, '::after').content);

  const activity = page.locator('.activities-row .empty-backbone-column:not(.phantom-column)').nth(1);
  expect(await label(activity), 'nothing shows until the pointer is over the cell').toBe('none');
  await activity.hover();
  expect(await label(activity)).toBe('"+ activity"');

  const user = page.locator('.users-row .empty-backbone-column:not(.phantom-column)').nth(1);
  await user.hover();
  expect(await label(user)).toBe('"+ user"');
  expect(await label(activity), 'the label goes when the pointer leaves').toBe('none');

  // The whole cell still adds the card
  await user.click();
  await expect(page.locator('.users-row .story-card')).toHaveCount(1);

  // Beside a user card, the box is as tall as the card and stops above the "+ user" button
  const beside = page.locator('.users-row .empty-backbone-column:not(.phantom-column)').first();
  await beside.hover();
  const sizes = await beside.evaluate((el) => ({
    box: Math.round(['height', 'borderTopWidth', 'borderBottomWidth'].reduce((sum, key) => sum + parseFloat(getComputedStyle(el, '::after')[key]), 0)),
    card: document.querySelector('.users-row .story-card').offsetHeight,
    cell: el.offsetHeight,
  }));
  expect(sizes.box).toBe(sizes.card);
  expect(sizes.cell).toBeGreaterThan(sizes.card);

  // A blank step past the last one
  const step = page.locator('.step-placeholder').first();
  await step.hover();
  expect(await label(step)).toBe('"+ step"');

  // Zoomed out, the dashed line is still at least a pixel on screen
  await page.evaluate(() => document.getElementById('storyMap').style.setProperty('--zoom', '0.76'));
  await step.hover();
  const line = await step.evaluate((el) => parseFloat(getComputedStyle(el, '::after').borderTopWidth));
  expect(line * 0.76).toBeGreaterThanOrEqual(1);
});

test('the blank columns past the last step have no outline until the pointer is over one', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  const outline = (cell) => cell.evaluate((el) => getComputedStyle(el).borderTopColor);
  const clear = 'rgba(0, 0, 0, 0)';

  for (const dark of [false, true]) {
    await page.evaluate((on) => document.documentElement.classList.toggle('dark-mode', on), dark);
    await page.mouse.move(0, 0);
    const column = page.locator('.slice-container .phantom-column').first();
    await expect.poll(() => outline(page.locator('.phantom-step').first())).toBe(clear);
    await expect.poll(() => outline(column)).toBe(clear);

    await column.hover();
    await expect.poll(() => outline(column), 'the outline shows under the pointer').not.toBe(clear);
  }
});

test('full screen swaps the header for a few floating buttons, with Share and Build in the menu', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  const shown = (selector) => page.locator(selector).isVisible();
  const mapTop = () => page.locator('#storyMapWrapper').evaluate((el) => el.getBoundingClientRect().top);
  const topBefore = await mapTop();

  await page.locator('#toggleFullscreenBtn').click();
  await expect(page.locator('body')).toHaveClass(/fullscreen-mode/);

  // The header's branding, the map name, Share and Build go, and so does the project prompt
  for (const gone of ['.header .logo', '#boardName', '#shareBtn', '#buildAiBtn', '#projectBar']) {
    expect(await shown(gone), `${gone} is hidden`).toBe(false);
  }
  // The buttons used while working stay, floating at the top right
  for (const kept of ['#searchBtn', '#undoBtn', '#redoBtn', '#menuBtn']) {
    expect(await shown(kept), `${kept} is shown`).toBe(true);
  }
  const box = await page.locator('.header').boundingBox();
  const width = page.viewportSize().width;
  expect(box.x + box.width).toBeGreaterThan(width - 40);
  expect(box.width).toBeLessThan(width / 2);
  // The story map takes the space the header had
  expect(await mapTop()).toBeLessThan(topBefore - 60);

  // Share and Build are in the menu, and do what the buttons do
  await page.locator('#menuBtn').click();
  const items = page.locator('#fullscreenMenuItems [data-clicks]:visible');
  await expect(items).toHaveText([/Share URL/, /Share as image/, /Download image/, /Build with AI/]);
  await items.filter({ hasText: 'Build with AI' }).click();
  await expect(page.locator('#buildAiModal')).toBeVisible();
  await page.locator('#buildAiModalClose').click();

  // Search opens in the floating box
  await page.locator('#searchBtn').click();
  await expect(page.locator('#searchInput')).toBeVisible();
  await page.keyboard.press('Escape');

  // Leaving full screen puts the header back, and the menu loses the extra items
  await page.locator('#toggleFullscreenBtn').click();
  await expect(page.locator('body')).not.toHaveClass(/fullscreen-mode/);
  for (const back of ['.header .logo', '#boardName', '#shareBtn', '#buildAiBtn']) {
    expect(await shown(back), `${back} is back`).toBe(true);
  }
  await page.locator('#menuBtn').click();
  await expect(page.locator('#fullscreenMenuItems')).toBeHidden();
});

test('on a short screen the menu scrolls inside the screen, in front of the map controls', async ({ page, createMap }) => {
  // A phone held sideways: wide enough for the desktop layout, and short
  await page.setViewportSize({ width: 915, height: 412 });
  await openMap(page, await createMap());
  await page.locator('#toggleFullscreenBtn').click();
  await expect(page.locator('body')).toHaveClass(/fullscreen-mode/);
  await page.locator('#menuBtn').click();

  const menu = page.locator('#mainMenu');
  const box = await menu.boundingBox();
  expect(box.y + box.height, 'the menu ends inside the screen').toBeLessThanOrEqual(412);
  expect(await menu.evaluate((el) => el.scrollHeight > el.clientHeight), 'and scrolls').toBe(true);

  // The last item can be scrolled to and clicked: the controls at the bottom right are behind the menu
  const last = page.locator('#lockMapBtn');
  await last.scrollIntoViewIfNeeded();
  const onTop = await last.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + 20, r.top + r.height / 2);
    return el === at || el.contains(at);
  });
  expect(onTop).toBe(true);
});

test('Download image saves the story map as a PNG', async ({ page, createMap }) => {
  await openMap(page, await createMap());
  // The image is handed to the browser through a link that is never added to the page
  await page.evaluate(() => {
    HTMLAnchorElement.prototype.click = function () { window.savedImage = { name: this.download, href: this.href.slice(0, 22) }; };
  });
  await page.locator('#shareBtn').click();
  await page.locator('#shareDownload').click();
  await expect.poll(() => page.evaluate(() => window.savedImage?.name)).toMatch(/^coffee-app-.*\.png$/);
  expect(await page.evaluate(() => window.savedImage.href)).toBe('data:image/png;base64,');
  await expect(page.locator('#shareBtn .btn-label')).toHaveText(/Share/);
});
