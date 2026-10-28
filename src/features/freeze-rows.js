// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Freeze the steps row, and optionally activities and users, while scrolling down.
// The choice is saved per browser, like dark mode, and never touches the map itself.
//
// The top rows sit in their own part of the map (src/ui/map-top.js), which isn't zoomed, so it
// can use position: sticky and the browser keeps it exactly in place. When only some rows are
// frozen, it sticks with a negative offset, so the rows above them go out of view.

import { dom } from '/src/ui/dom.js';
import { mapTop } from '/src/ui/map-top.js';
import { FREEZE_MODES, normalizeFreezeMode } from '/src/core/freeze-rows.js';

const STORAGE_KEY = 'freezeRows';

let mode = normalizeFreezeMode(null);
// The scroll position where the frozen rows reach the top, or null when nothing is frozen
let stickAt = null;
// The height of the rows above the frozen ones, which go out of view, in screen pixels
let hiddenAbove = 0;
let lastZoom = null;

const readMode = () => {
    try { return normalizeFreezeMode(localStorage.getItem(STORAGE_KEY)); } catch { return normalizeFreezeMode(null); }
};

const zoomOf = (map) => parseFloat(map.style.getPropertyValue('--zoom')) || 1;

// The shadow under the frozen rows shows once they stick
const onScroll = () => {
    if (stickAt === null) return;
    dom.storyMapWrapper.classList.toggle('rows-stuck', dom.storyMapWrapper.scrollTop > stickAt + 1);
};

// Work out how far up the top part sticks and where it starts sticking. Runs after every render,
// zoom and resize, never on scroll.
const update = () => {
    const map = dom.storyMap;
    const wrapper = dom.storyMapWrapper;
    if (!map || !wrapper) return;

    const zoom = zoomOf(map);
    const zoomed = lastZoom !== null && zoom !== lastZoom;
    lastZoom = zoom;

    const top = mapTop(map);
    const firstClass = FREEZE_MODES[mode][0];
    const first = top && firstClass ? top.querySelector(`.${firstClass}`) : null;
    wrapper.classList.toggle('freeze-on', !!first);
    if (!first) {
        stickAt = null;
        hiddenAbove = 0;
        wrapper.classList.remove('rows-stuck');
        wrapper.style.removeProperty('--freeze-top');
        wrapper.style.scrollPaddingTop = '';
        return;
    }

    // Still the state from before this zoom: the scroll event for it hasn't run yet
    const wasStuck = wrapper.classList.contains('rows-stuck');
    hiddenAbove = first.getBoundingClientRect().top - top.firstElementChild.getBoundingClientRect().top;
    wrapper.style.setProperty('--freeze-top', `${-hiddenAbove}px`);
    // The top part is the first thing in the map
    stickAt = map.offsetTop + hiddenAbove;
    // Scrolling something into view stops below the frozen rows, not under them
    wrapper.style.scrollPaddingTop = `${frozenRowsHeight()}px`;

    // Zooming keeps the middle of the view still, which scrolls the map. If the rows were in their
    // own place before the zoom, keep them there, rather than let them stick over the cards below.
    if (zoomed && !wasStuck && wrapper.scrollTop > stickAt) wrapper.scrollTop = Math.floor(stickAt);
    onScroll();
};

// How much of the top of the map area the frozen rows cover once they stick, in screen pixels,
// so scrolling to a slice can land it below them
export const frozenRowsHeight = () => {
    const top = stickAt === null ? null : mapTop(dom.storyMap);
    return top ? top.getBoundingClientRect().height - hiddenAbove : 0;
};

// =============================================================================
// The menu
// =============================================================================

const isMenuOpen = () => !dom.freezeMenu.hidden;

const syncControls = () => {
    dom.toggleFreezeBtn.classList.toggle('active', mode !== 'off');
    dom.freezeMenu.querySelectorAll('input[name="freezeRows"]').forEach(input => {
        input.checked = input.value === mode;
    });
};

const openMenu = () => {
    syncControls();
    dom.freezeMenu.hidden = false;
    dom.toggleFreezeBtn.setAttribute('aria-expanded', 'true');
    dom.freezeMenu.querySelector('input:checked')?.focus();
};

const closeMenu = ({ returnFocus = false } = {}) => {
    if (!isMenuOpen()) return;
    dom.freezeMenu.hidden = true;
    dom.toggleFreezeBtn.setAttribute('aria-expanded', 'false');
    if (returnFocus) dom.toggleFreezeBtn.focus();
};

export const setFreezeMode = (value) => {
    mode = normalizeFreezeMode(value);
    try { localStorage.setItem(STORAGE_KEY, mode); } catch {}
    syncControls();
    update();
};

export const init = () => {
    const map = dom.storyMap;
    const wrapper = dom.storyMapWrapper;
    if (!map || !wrapper || !dom.toggleFreezeBtn || !dom.freezeMenu) return;

    mode = readMode();
    syncControls();

    // Render replaces the rows, and zoom changes the map's inline style
    new MutationObserver(update).observe(map, { childList: true, attributes: true, attributeFilter: ['style'] });
    const resize = new ResizeObserver(update);
    resize.observe(map);
    resize.observe(wrapper);
    wrapper.addEventListener('scroll', onScroll, { passive: true });

    dom.toggleFreezeBtn.addEventListener('click', () => {
        if (isMenuOpen()) closeMenu();
        else openMenu();
    });
    dom.freezeMenu.addEventListener('change', (e) => {
        if (e.target.name === 'freezeRows') setFreezeMode(e.target.value);
    });
    dom.freezeMenu.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            closeMenu({ returnFocus: true });
        }
    });
    document.addEventListener('pointerdown', (e) => {
        if (isMenuOpen() && !dom.freezeMenu.contains(e.target) && !dom.toggleFreezeBtn.contains(e.target)) closeMenu();
    });

    update();
};
