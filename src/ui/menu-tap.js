// =============================================================================
// On a touch screen, a tap on the map while a menu is open only closes the menu. Without this
// the same tap also lands on the map, so closing a menu could start editing a card and bring up
// the keyboard. Taps on other buttons still work, and a mouse click on the map still does both.
// =============================================================================

// Menus that close on a tap outside them
const OPEN_MENUS = '#mainMenu.visible, #shareMenu.visible, .options-menu.visible, #freezeMenu:not([hidden]), .canvas-context-menu, .selection-toolbar-split-menu.visible';
// The menus, and the map buttons that open them, keep their taps
const KEEP = '.options-menu, .selection-toolbar-split, .btn-options, .btn-slice-menu';

let _guarding = false;

export const init = (closeMenus) => {
    // Decided on the press, before any menu that closes on the press has gone
    document.addEventListener('pointerdown', (e) => {
        _guarding = e.pointerType === 'touch' && e.isPrimary && !!document.querySelector(OPEN_MENUS)
            && !!e.target.closest?.('#storyMapWrapper') && !e.target.closest(KEEP);
    }, { capture: true });

    // Cancelling the end of the touch stops the click and the focus that would follow it
    document.addEventListener('touchend', (e) => {
        if (!_guarding) return;
        _guarding = false;
        if (e.cancelable) e.preventDefault();
        closeMenus();
    }, { capture: true, passive: false });

    document.addEventListener('touchcancel', () => { _guarding = false; }, { capture: true });
};
