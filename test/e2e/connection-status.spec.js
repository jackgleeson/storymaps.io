import { test, expect, openMap } from './fixtures.js';

const MAP = `name: Coffee app
steps:
  - Browse
  - Order
  - Pay
slices:
  - name: MVP
    stories:
      Browse:
        - name: Menu
`;

// Let the map connect, and return a function that drops the connection and refuses reconnects
const openWithDroppableConnection = async (page, createMap) => {
  const id = await createMap(MAP);
  let socket;
  await page.routeWebSocket(/.*/, ws => { socket = ws; ws.connectToServer(); });
  await openMap(page, id);
  await expect.poll(() => !!socket).toBe(true);
  return {
    id,
    drop: async () => {
      await page.routeWebSocket(/.*/, ws => ws.close());
      await socket.close();
    },
    reconnect: () => page.routeWebSocket(/.*/, ws => { ws.connectToServer(); }),
  };
};

const notice = (page) => page.locator('#connectionNotice');
const firstCard = (page) => page.locator('.story-card textarea').first();

test('a dropped connection shows a notice, and changes made offline sync when it comes back', async ({ page, createMap, pullMap }) => {
  const { id, drop, reconnect } = await openWithDroppableConnection(page, createMap);
  await drop();
  await expect(notice(page)).toHaveText('Offline. Reconnecting...');

  await firstCard(page).fill('Menu, edited offline');
  await firstCard(page).blur();
  await expect(notice(page)).toHaveText('Offline. Your changes will sync when you reconnect.');

  await reconnect();
  await expect(notice(page)).toBeHidden({ timeout: 10_000 });
  await expect.poll(async () => (await pullMap(id)).slices[0].stories[0][0].name).toBe('Menu, edited offline');
});

test('closing the tab with changes that have not synced asks first', async ({ page, createMap }) => {
  const { drop } = await openWithDroppableConnection(page, createMap);
  await drop();
  await firstCard(page).fill('Menu, edited offline');
  await firstCard(page).blur();
  await expect(notice(page)).toContainText('Your changes will sync');

  const dialog = page.waitForEvent('dialog');
  page.close({ runBeforeUnload: true });
  expect((await dialog).type()).toBe('beforeunload');
  await (await dialog).accept();
});

test('closing the tab while connected does not ask', async ({ page, createMap }) => {
  await openMap(page, await createMap(MAP));
  await firstCard(page).fill('Menu, edited online');
  await firstCard(page).blur();
  let asked = false;
  page.on('dialog', d => { asked = true; d.accept(); });
  await page.close({ runBeforeUnload: true });
  expect(asked).toBe(false);
});

test('switching the network off shows the notice at once, and switching it back on reconnects', async ({ page, context, createMap, pullMap }) => {
  const id = await createMap(MAP);
  await openMap(page, id);
  await context.setOffline(true);
  await expect(notice(page)).toHaveText('Offline. Reconnecting...', { timeout: 1500 });

  await firstCard(page).fill('Menu, edited offline');
  await firstCard(page).blur();
  await expect(notice(page)).toHaveText('Offline. Your changes will sync when you reconnect.');

  await context.setOffline(false);
  await expect(notice(page)).toHaveText('Back online. Your changes are saved.', { timeout: 10_000 });
  await expect(notice(page)).toHaveClass(/is-online/);
  await expect(notice(page)).toBeHidden({ timeout: 5000 });
  await expect.poll(async () => (await pullMap(id)).slices[0].stories[0][0].name).toBe('Menu, edited offline');
});

test('a connection that goes silent without closing is noticed within seconds', async ({ page, createMap, pullMap }) => {
  const id = await createMap(MAP);
  // Pass messages both ways until the line goes dead, as when wifi drops but the socket stays
  // open. While it's dead, new connections fail, as they would with no network.
  let dead = false;
  await page.routeWebSocket(/.*/, ws => {
    if (dead) { ws.close(); return; }
    const server = ws.connectToServer();
    ws.onMessage(m => { if (!dead) server.send(m); });
    server.onMessage(m => { if (!dead) ws.send(m); });
  });
  await openMap(page, id);
  await page.waitForTimeout(500);
  dead = true;
  const started = Date.now();
  await expect(notice(page)).toBeVisible({ timeout: 10_000 });
  expect(Date.now() - started).toBeLessThan(9000);

  // Edits from then on count as unsynced, and arrive once the line works again
  await firstCard(page).fill('Menu, edited while silent');
  await firstCard(page).blur();
  await expect(notice(page)).toHaveText('Offline. Your changes will sync when you reconnect.');
  dead = false;
  await expect(notice(page)).toHaveText('Back online. Your changes are saved.', { timeout: 10_000 });
  await expect.poll(async () => (await pullMap(id)).slices[0].stories[0][0].name).toBe('Menu, edited while silent');
});
