import { createHash } from 'node:crypto';
import { test, expect, openMap, acceptDialog, openMenu, addCard } from './fixtures.js';

const hash = (password) => createHash('sha256').update(password).digest('hex');

const enterPassword = async (page, password) => {
  await page.locator('#lockPasswordInput').fill(password);
  await page.locator('#lockModalConfirm').click();
};

test('lock a map, then change and remove the lock after a reload', async ({ page, createMap, request }) => {
  const id = await createMap();
  const isLocked = async () => (await (await request.get(`/api/lock/${id}`)).json()).isLocked;
  await openMap(page, id);

  await openMenu(page, 'lockMapBtn');
  await enterPassword(page, 'first-pass');
  expect(await acceptDialog(page)).toMatch(/^Map is now read-only/);
  expect(await isLocked()).toBe(true);

  // The tab stays unlocked after a reload, so it can still change the password
  await page.reload();
  await expect(page.locator('.step')).toHaveCount(3);
  await openMenu(page, 'updatePasswordBtn');
  await enterPassword(page, 'second-pass');
  await acceptDialog(page);
  const unlock = await request.post(`/api/lock/${id}/unlock`, { data: { passwordHash: hash('second-pass') } });
  expect(unlock.status()).toBe(200);

  // ...and remove the lock
  await page.reload();
  await expect(page.locator('.step')).toHaveCount(3);
  await openMenu(page, 'removeLockBtn');
  await acceptDialog(page);
  await expect.poll(isLocked).toBe(false);
});

// The server takes live edits to a locked map only from a tab that has sent it the password
test('edits to a locked map save from the tab that locked it, after a reload, and from a tab that unlocks it', async ({ page, createMap, request, openSecondTab }) => {
  const id = await createMap();
  const saved = async () => JSON.stringify(await (await request.get(`/api/maps/${id}`)).json());
  await openMap(page, id);
  await openMenu(page, 'lockMapBtn');
  await enterPassword(page, 'pass');
  await acceptDialog(page);
  await addCard(page, 'Added by the locker');
  await expect.poll(saved).toContain('Added by the locker');

  await page.reload();
  await expect(page.locator('.step')).toHaveCount(3);
  await addCard(page, 'Added after a reload');
  await expect.poll(saved).toContain('Added after a reload');

  const other = await openSecondTab();
  await openMap(other, id);
  await expect(other.getByText('This map is read-only')).toBeVisible();
  await openMenu(other, 'lockMapBtn');
  await enterPassword(other, 'pass');
  await expect(other.locator('#readOnlyBanner')).toBeHidden();
  await addCard(other, 'Added after unlocking');
  await expect.poll(saved).toContain('Added after unlocking');
});

test('a tab without the password cannot change a locked map, even round the read-only view', async ({ page, createMap, request }) => {
  const id = await createMap();
  await request.post(`/api/lock/${id}`, { data: { passwordHash: hash('pass') } });
  await openMap(page, id);
  await expect(page.getByText('This map is read-only')).toBeVisible();
  // As someone could from the browser console: write to the shared map directly
  await page.evaluate(async () => (await import('/src/core/yjs.js')).getYdoc().getMap('storymap').set('name', 'Changed'));
  expect(await page.evaluate(async () => (await import('/src/core/yjs.js')).getYdoc().getMap('storymap').get('name'))).toBe('Changed');
  await page.waitForTimeout(500);
  expect((await (await request.get(`/api/maps/${id}`)).json()).name).not.toBe('Changed');
});

test('when someone else locks the map first, the app says so and goes read-only', async ({ page, createMap, request }) => {
  const id = await createMap();
  await openMap(page, id);
  await openMenu(page, 'lockMapBtn');
  await expect(page.locator('#lockPasswordInput')).toBeVisible();

  await request.post(`/api/lock/${id}`, { data: { passwordHash: hash('someone-else') } });
  await enterPassword(page, 'too-late');
  expect(await acceptDialog(page)).toBe('This map has already been locked by someone else.');
  await expect(page.getByText('This map is read-only')).toBeVisible();
});

// The lock poll is a fallback for lock changes that don't come through the live connection, like
// a lock set through the API. A page in a background tab doesn't poll, and checks once on return
test('a hidden page stops checking the lock, and checks at once when it comes back into view', async ({ page, createMap, request }) => {
  const id = await createMap();
  await openMap(page, id);
  const setVisibility = (state) => page.evaluate((state) => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
  // Count from once the page is hidden: a check already under way doesn't count
  await setVisibility('hidden');
  await page.waitForTimeout(500);
  let polls = 0;
  page.on('request', (req) => { if (req.url().endsWith(`/api/lock/${id}`)) polls++; });
  await request.post(`/api/lock/${id}`, { data: { passwordHash: hash('elsewhere') } });
  await page.waitForTimeout(7000);
  expect(polls).toBe(0);
  await expect(page.getByText('This map is read-only')).toBeHidden();

  await setVisibility('visible');
  await expect(page.getByText('This map is read-only')).toBeVisible({ timeout: 2000 });
  expect(polls).toBe(1);
});

test('in full screen the floating buttons sit over the read-only banner, not under it', async ({ page, createMap, request }) => {
  const id = await createMap();
  await request.post(`/api/lock/${id}`, { data: { passwordHash: hash('pass') } });
  await openMap(page, id);
  await expect(page.getByText('This map is read-only')).toBeVisible();

  await page.locator('#toggleFullscreenBtn').click();
  await expect(page.locator('body')).toHaveClass(/fullscreen-mode/);

  // Every button in the box can be reached: nothing lies over its top edge
  for (const id of ['searchBtn', 'undoBtn', 'redoBtn', 'menuBtn']) {
    const onTop = await page.locator(`#${id}`).evaluate((el) => {
      const box = el.getBoundingClientRect();
      const at = document.elementFromPoint(box.left + box.width / 2, box.top + 2);
      return el === at || el.contains(at);
    });
    expect(onTop, `${id} is not covered`).toBe(true);
  }
  // The banner is still there, and its words are clear of the box
  const banner = await page.locator('.read-only-banner-text').boundingBox();
  const box = await page.locator('.header').boundingBox();
  expect(banner.x + banner.width).toBeLessThan(box.x);
  // The story map starts below the banner
  const mapTop = await page.locator('#storyMapWrapper').evaluate((el) => el.getBoundingClientRect().top);
  const bannerBottom = await page.locator('#readOnlyBanner').evaluate((el) => el.getBoundingClientRect().bottom);
  expect(mapTop).toBeGreaterThanOrEqual(bannerBottom);
});

test('a locked story map is read-only from the first draw, while the name prompt is still up', async ({ page, createMap, request, pullMap }) => {
  const id = await createMap(`name: Locked
steps:
  - Browse
slices:
  - name: Now
    stories:
      Browse:
        - name: Drink list
          body: See the menu
`);
  expect((await request.post(`/api/lock/${id}`, { data: { passwordHash: hash('secret') } })).status()).toBe(200);
  // No name saved, so the app asks for one, as it does for a first visit
  await page.addInitScript(() => localStorage.removeItem('presenceName'));
  await page.goto(`/${id}`);
  await expect(page.getByText('Enter your name for live collaboration')).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/read-only-mode/);
  await expect(page.locator('.slice-container .story-card textarea.story-text')).toHaveCount(1);
  await expect(page.locator('.btn-add-story').first()).toBeHidden();

  // A card opened from its link behind the prompt can't be changed either
  const cardId = await page.locator('.slice-container .story-card').first().getAttribute('data-story-id');
  await page.goto('about:blank');
  await page.goto(`/${id}#card-${cardId}`);
  await expect(page.getByText('Enter your name for live collaboration')).toBeVisible();
  await expect(page.locator('#cardExpandModal')).toBeVisible();
  await expect(page.locator('#cardExpandChips')).toBeHidden();
  await expect(page.locator('#cardExpandName')).toHaveJSProperty('readOnly', true);
  await expect(page.locator('.card-expand-md .cm-content')).toHaveAttribute('contenteditable', 'false');
});
