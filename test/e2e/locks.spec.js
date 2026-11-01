import { createHash } from 'node:crypto';
import { test, expect, openMap, acceptDialog, openMenu } from './fixtures.js';

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
