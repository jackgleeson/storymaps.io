import { test, expect, openMap } from './fixtures.js';

const MAP = `name: Menus
steps:
  - First
  - Second
  - Third
slices:
  - name: MVP
    stories:
      First:
        - name: Card one
      Second:
        - name: Card two
      Third:
        - name: Card three
`;

// Each menu: how to open it, and what shows it's open
const MENUS = [
  { name: 'main menu', open: p => p.locator('#menuBtn').tap(), shown: '#mainMenu.visible' },
  { name: 'share menu', open: p => p.locator('#shareBtn').tap(), shown: '#shareMenu.visible' },
  { name: 'card menu', open: p => p.locator('.story-card .btn-options').nth(2).tap(), shown: '.options-menu.visible' },
  { name: 'freeze rows menu', open: p => p.locator('#toggleFreezeBtn').tap(), shown: '#freezeMenu:not([hidden])' },
  { name: 'slice menu', open: p => p.locator('.btn-slice-menu').first().tap(), shown: '.slice-context-menu' },
];

for (const menu of MENUS) {
  test(`on a phone a tap outside the ${menu.name} closes it without editing the card underneath`, async ({ page, createMap }) => {
    const id = await createMap(MAP);
    await openMap(page, id, 3);
    await menu.open(page);
    await expect(page.locator(menu.shown)).toBeVisible();
    const card = page.locator('.story-card textarea').first();
    const box = await card.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator(menu.shown)).toHaveCount(0);
    await page.waitForTimeout(300);
    await expect(card).not.toBeFocused();

    // With the menu closed, the next tap edits the card as usual
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(card).toBeFocused();
  });
}
