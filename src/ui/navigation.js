// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Navigation: zoom, pan, scroll, menu helpers

import { ZOOM_LEVELS } from '/src/core/constants.js';

let _dom = null;
let _state = null;
let _updateSelectionUI = null;
let _selection = null;
let _clearSelection = null;
let _isMapEditable = null;
let _addColumnAt = null;
let _deleteColumn = null;
let _duplicateColumns = null;
let _duplicateCards = null;
let _deleteSelectedColumns = null;
let _deleteSelectedCards = null;
let _insertPartialMapRef = null;

// Marquee state
let isMarquee = false;
let marqueeStartX = 0;
let marqueeStartY = 0;
let marqueeEl = null;
let marqueeRaf = null;
let mousedownTarget = null;
let didMarquee = false;
const MARQUEE_THRESHOLD = 5;

// Zoom state
export let zoomLevel = 1;
export let isPinching = false;
const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 3;

// Pan/drag state
export let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panScrollLeft = 0;
let panScrollTop = 0;

export const init = ({ state, updateSelectionUI, selection, clearSelection, isMapEditable, addColumnAt, deleteColumn, duplicateColumns, duplicateCards, deleteSelectedColumns, deleteSelectedCards, insertPartialMapRef }) => {
    _dom = {
        storyMap: document.getElementById('storyMap'),
        storyMapWrapper: document.getElementById('storyMapWrapper'),
        zoomReset: document.getElementById('zoomReset'),
        mainMenu: document.getElementById('mainMenu'),
        samplesSubmenu: document.getElementById('samplesSubmenu'),
        samplesSubmenuTrigger: document.getElementById('samplesSubmenuTrigger'),
        importSubmenu: document.getElementById('importSubmenu'),
        importSubmenuTrigger: document.getElementById('importSubmenuTrigger'),
        exportSubmenu: document.getElementById('exportSubmenu'),
        exportSubmenuTrigger: document.getElementById('exportSubmenuTrigger'),
    };
    _state = state;
    _updateSelectionUI = updateSelectionUI;
    _selection = selection;
    _clearSelection = clearSelection;
    _isMapEditable = isMapEditable;
    _addColumnAt = addColumnAt;
    _deleteColumn = deleteColumn;
    _duplicateColumns = duplicateColumns;
    _duplicateCards = duplicateCards;
    _deleteSelectedColumns = deleteSelectedColumns;
    _deleteSelectedCards = deleteSelectedCards;
    _insertPartialMapRef = insertPartialMapRef;
};

const updatePanMode = () => {
    const wrapper = _dom.storyMapWrapper;
    const hasOverflow = wrapper.scrollWidth > wrapper.clientWidth || wrapper.scrollHeight > wrapper.clientHeight;
    if (hasOverflow) {
        wrapper.classList.add('pan-enabled');
    } else {
        wrapper.classList.remove('pan-enabled');
    }
};

// transform: scale() with origin top-left extends content past the layout box,
// but scrollWidth is based on layout — so native scroll/pan can't reach the overflow.
// Expand right/bottom margins so the full scaled content is scrollable.
const updateZoomScrollBounds = () => {
    const map = _dom.storyMap;
    if (zoomLevel <= 1) {
        map.style.marginRight = '';
        map.style.marginBottom = '';
        return;
    }
    const extraW = Math.ceil(map.offsetWidth * (zoomLevel - 1));
    const extraH = Math.ceil(map.offsetHeight * (zoomLevel - 1));
    map.style.marginRight = `calc(150vw + ${extraW}px)`;
    map.style.marginBottom = `calc(100vh + ${extraH}px)`;
};

export const updateZoom = () => {
    _dom.storyMap.style.transform = `scale(${zoomLevel})`;
    _dom.storyMap.style.setProperty('--zoom', zoomLevel);
    _dom.zoomReset.textContent = `${Math.round(zoomLevel * 100)}%`;
    updateZoomScrollBounds();
    updatePanMode();
};

// Scroll to position content naturally in viewport
export const centerScroll = () => {
    const wrapper = _dom.storyMapWrapper;
    const map = _dom.storyMap;

    // Compute actual column content width (map has min-width: 100vw so offsetWidth is unreliable)
    const CARD_W = 180, LABEL_W = 80, GAP = 10;
    const cols = _state.columns.length;
    const contentW = (LABEL_W + cols * (CARD_W + GAP)) * zoomLevel;
    const slack = wrapper.clientWidth - contentW;

    if (slack > 0 && cols < 7) {
        // Align with header left edge (header is max-width:1400px, centered)
        const headerOffset = Math.max(0, (wrapper.clientWidth - 1400) / 2);
        wrapper.scrollLeft = map.offsetLeft - headerOffset;
    } else if (slack > 0) {
        // Wider map on large screen: offset 1/3 of gap to left
        wrapper.scrollLeft = map.offsetLeft - slack / 3;
    } else {
        wrapper.scrollLeft = map.offsetLeft;
    }

    // Vertically: start near the top with a small breathing offset
    wrapper.scrollTop = map.offsetTop - 20;
};

// Auto-fit zoom on window resize (preserves scroll position)
let lastWrapperWidth = 0;
export const resizeToFit = () => {
    const wrapper = _dom.storyMapWrapper;
    if (!wrapper || !_state.columns.length) return;
    const currentWidth = wrapper.clientWidth;
    if (currentWidth === lastWrapperWidth) return;
    lastWrapperWidth = currentWidth;

    const CARD_WIDTH = 180;
    const LABEL_WIDTH = 80;
    const GAP = 10;
    const PHANTOM_COUNT = 3;
    const BODY_PADDING = 48;

    const columnCount = _state.columns.length + PHANTOM_COUNT;
    const contentWidth = LABEL_WIDTH + (columnCount * CARD_WIDTH) + (columnCount * GAP);
    const availableWidth = currentWidth - BODY_PADDING;
    const fitZoom = Math.min(1, (availableWidth - 20) / contentWidth);
    const effectiveMin = currentWidth < 600 ? 0.5 : ZOOM_MIN;
    zoomLevel = Math.max(effectiveMin, Math.min(ZOOM_MAX, Math.floor(fitZoom * 20) / 20));
    updateZoom();
    centerScroll();
};

// Auto-fit content to viewport width
export const zoomToFit = () => {
    const wrapper = _dom.storyMapWrapper;

    // Calculate content width based on column count + phantom buffer
    const CARD_WIDTH = 180;
    const LABEL_WIDTH = 80;
    const GAP = 10;
    const PHANTOM_COUNT = 3;
    const BODY_PADDING = 48;

    const columnCount = _state.columns.length + PHANTOM_COUNT;
    const contentWidth = LABEL_WIDTH + (columnCount * CARD_WIDTH) + (columnCount * GAP);

    const availableWidth = wrapper.clientWidth - BODY_PADDING;

    const fitZoom = Math.min(1, (availableWidth - 20) / contentWidth);

    // On small screens, don't zoom below 0.5 — users scroll horizontally instead
    const effectiveMin = wrapper.clientWidth < 600 ? 0.5 : ZOOM_MIN;
    zoomLevel = Math.max(effectiveMin, Math.min(ZOOM_MAX, Math.floor(fitZoom * 20) / 20));

    updateZoom();
    centerScroll();
    lastWrapperWidth = wrapper.clientWidth;
};

// Scroll element into view with padding
export const scrollElementIntoView = (element) => {
    if (!element) return;
    const wrapper = _dom.storyMapWrapper;
    const rect = element.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    const padding = 40;

    // Use viewport coordinates directly — no zoom division needed
    if (rect.right > wrapperRect.right - padding) {
        wrapper.scrollLeft += rect.right - wrapperRect.right + padding;
    }
    if (rect.left < wrapperRect.left + padding) {
        wrapper.scrollLeft -= wrapperRect.left + padding - rect.left;
    }
    if (rect.bottom > wrapperRect.bottom - padding) {
        wrapper.scrollTop += rect.bottom - wrapperRect.bottom + padding;
    }
};

// Context menu state
let contextMenuEl = null;
let panDidMove = false;

const resolveColumn = (target) => {
    const el = target.closest('.step, .story-column, .step-placeholder, .partial-map-ref, .partial-map-ref-cell');
    if (!el) return { columnId: null, columnIndex: null };
    const columnId = el.dataset.columnId;
    const columnIndex = _state.columns.findIndex(c => c.id === columnId);
    return { columnId, columnIndex: columnIndex >= 0 ? columnIndex : null };
};

const onDismissContextMenu = (e) => {
    if (contextMenuEl && contextMenuEl.contains(e.target)) return;
    dismissContextMenu();
};

const onDismissContextMenuKey = (e) => {
    if (e.key === 'Escape') dismissContextMenu();
};

const dismissContextMenu = () => {
    if (!contextMenuEl) return;
    contextMenuEl.remove();
    contextMenuEl = null;
    document.removeEventListener('mousedown', onDismissContextMenu, { capture: true });
    document.removeEventListener('keydown', onDismissContextMenuKey, { capture: true });
    _dom.storyMapWrapper.removeEventListener('scroll', onDismissContextMenu);
};

const makeMenuItem = (label, icon, action, destructive = false) => {
    const btn = document.createElement('button');
    if (destructive) btn.className = 'destructive';
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${icon}</svg><span>${label}</span>`;
    btn.addEventListener('click', () => { action(); dismissContextMenu(); });
    return btn;
};

const ICON_ADD_SPACER = '<line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/>';
const ICON_DELETE = '<polyline points="3 5 4 13 12 13 13 5"/><line x1="2" y1="5" x2="14" y2="5"/><line x1="6" y1="3" x2="10" y2="3"/>';
const ICON_DUPLICATE = '<rect x="3" y="3" width="8" height="10" rx="1.5"/><path d="M6 3V2.5A1.5 1.5 0 0 1 7.5 1H12a1.5 1.5 0 0 1 1.5 1.5V11A1.5 1.5 0 0 1 12 12.5H11"/>';
const ICON_INSERT_PARTIAL = '<rect x="2" y="2" width="5" height="5" rx="0.7" fill="#fef08a" stroke="#d4aa00" stroke-width="0.7"/><rect x="9" y="2" width="5" height="5" rx="0.7" fill="#fecdd3" stroke="#e88a9a" stroke-width="0.7"/><rect x="2" y="9" width="5" height="5" rx="0.7" fill="#a5f3fc" stroke="#67c5d6" stroke-width="0.7"/><rect x="9" y="9" width="5" height="5" rx="0.7" fill="#14b8a6" stroke="#0d9488" stroke-width="0.7"/>';

const addSep = (menu) => {
    const sep = document.createElement('div');
    sep.className = 'context-menu-sep';
    menu.appendChild(sep);
};

const positionMenu = (menu, x, y) => {
    document.body.appendChild(menu);
    contextMenuEl = menu;

    const rect = menu.getBoundingClientRect();
    const overflowX = x + rect.width - window.innerWidth + 8;
    const overflowY = y + rect.height - window.innerHeight + 8;
    menu.style.left = (overflowX > 0 ? x - overflowX : x) + 'px';
    menu.style.top = (overflowY > 0 ? y - overflowY : y) + 'px';

    setTimeout(() => {
        document.addEventListener('mousedown', onDismissContextMenu, { capture: true });
        document.addEventListener('keydown', onDismissContextMenuKey, { capture: true });
        _dom.storyMapWrapper.addEventListener('scroll', onDismissContextMenu);
    });
};

const showContextMenu = (x, y, columnId, columnIndex) => {
    dismissContextMenu();
    const menu = document.createElement('div');
    menu.className = 'canvas-context-menu';

    if (_selection.columnIds.length > 0) return;

    menu.appendChild(makeMenuItem('Add spacer column', ICON_ADD_SPACER, () => {
        _addColumnAt(columnIndex !== null ? columnIndex + 1 : _state.columns.length, true);
    }));

    // Insert partial map references (flyout submenu)
    if (_state.partialMaps.length > 0 && _insertPartialMapRef) {
        addSep(menu);
        const wrapper = document.createElement('div');
        wrapper.className = 'ctx-submenu-wrapper';
        const trigger = document.createElement('button');
        trigger.className = 'ctx-submenu-trigger';
        trigger.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICON_INSERT_PARTIAL}</svg><span>Add Partial Step</span><span class="ctx-submenu-arrow">›</span>`;
        const submenu = document.createElement('div');
        submenu.className = 'ctx-submenu canvas-context-menu';
        const insertIdx = columnIndex !== null ? columnIndex : _state.columns.length - 1;
        _state.partialMaps.forEach(pm => {
            submenu.appendChild(makeMenuItem(
                `${pm.name} (${pm.columns.length} step${pm.columns.length !== 1 ? 's' : ''})`,
                ICON_INSERT_PARTIAL,
                () => _insertPartialMapRef(pm.id, insertIdx)
            ));
        });
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const show = !submenu.classList.contains('visible');
            submenu.classList.toggle('visible', show);
            trigger.classList.toggle('expanded', show);
            if (show) {
                requestAnimationFrame(() => {
                    const triggerRect = trigger.getBoundingClientRect();
                    const subRect = submenu.getBoundingClientRect();
                    // Horizontal: prefer right, fall back to left
                    const spaceRight = window.innerWidth - triggerRect.right - 8;
                    if (spaceRight >= subRect.width) {
                        submenu.style.left = '100%';
                        submenu.style.right = '';
                    } else {
                        submenu.style.right = '100%';
                        submenu.style.left = '';
                    }
                    // Vertical: align top with trigger, clamp to viewport
                    submenu.style.top = '0px';
                    const newRect = submenu.getBoundingClientRect();
                    const overflowY = newRect.bottom - window.innerHeight + 8;
                    if (overflowY > 0) {
                        submenu.style.top = -overflowY + 'px';
                    }
                });
            }
        });
        wrapper.appendChild(trigger);
        wrapper.appendChild(submenu);
        menu.appendChild(wrapper);
    }

    if (columnId) {
        const col = _state.columns.find(c => c.id === columnId);
        if (col) {
            addSep(menu);
            menu.appendChild(makeMenuItem('Delete column', ICON_DELETE, () => {
                _deleteColumn(columnId);
            }, true));
        }
    }

    positionMenu(menu, x, y);
};

export const initPan = () => {
    const wrapper = _dom.storyMapWrapper;

    // Suppress native browser context menu (custom menu shown on mouseup instead)
    wrapper.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    wrapper.addEventListener('mousedown', (e) => {
        if (e.button !== 2) return;
        e.preventDefault();
        dismissContextMenu();

        isPanning = true;
        panDidMove = false;
        panStartX = e.clientX;
        panStartY = e.clientY;
        panScrollLeft = wrapper.scrollLeft;
        panScrollTop = wrapper.scrollTop;
        wrapper.classList.add('panning');
    });

    document.addEventListener('mousemove', (e) => {
        if (!isPanning) return;
        e.preventDefault();
        panDidMove = true;
        wrapper.scrollLeft = panScrollLeft - (e.clientX - panStartX);
        wrapper.scrollTop = panScrollTop - (e.clientY - panStartY);
    });

    document.addEventListener('mouseup', (e) => {
        if (!isPanning) return;
        isPanning = false;
        wrapper.classList.remove('panning');

        if (!panDidMove && e.button === 2
            && _isMapEditable()
            && !window.matchMedia('(pointer: coarse)').matches) {
            const { columnId, columnIndex } = resolveColumn(e.target);
            showContextMenu(e.clientX, e.clientY, columnId, columnIndex);
        }
    });
};

// Menu helpers

export const closeMainMenu = () => {
    _dom.mainMenu.classList.remove('visible');
    _dom.samplesSubmenu.classList.remove('visible');
    _dom.samplesSubmenuTrigger.classList.remove('expanded');
    _dom.importSubmenu.classList.remove('visible');
    _dom.importSubmenuTrigger.classList.remove('expanded');
    _dom.exportSubmenu.classList.remove('visible');
    _dom.exportSubmenuTrigger.classList.remove('expanded');
    _dom.mainMenu.querySelectorAll('.integration-icon').forEach(i => i.classList.remove('active'));
    _dom.mainMenu.querySelectorAll('.integration-options').forEach(o => o.classList.remove('visible'));
    document.body.classList.remove('main-menu-open');
};

export const closeAllOptionsMenus = () => {
    document.querySelectorAll('.options-menu.visible').forEach(m => {
        m.classList.remove('visible');
        m.closest('.step, .story-card')?.classList.remove('menu-open');
        m.parentElement?.querySelector('.btn-options')?.setAttribute('aria-expanded', 'false');
    });
    document.querySelectorAll('.slice-menu-dropdown.visible').forEach(m => {
        m.classList.remove('visible');
    });
};

export const initWheelZoom = () => {
    _dom.storyMapWrapper.addEventListener('wheel', (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        const wrapper = _dom.storyMapWrapper;
        const wrapperRect = wrapper.getBoundingClientRect();
        const oldZoom = zoomLevel;

        const delta = -e.deltaY * 0.0008;
        zoomLevel = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomLevel + delta));

        // Content-space coordinate under the cursor (relative to map origin)
        const mapLeft = _dom.storyMap.offsetLeft;
        const mapTop = _dom.storyMap.offsetTop;
        const cursorX = (e.clientX - wrapperRect.left + wrapper.scrollLeft - mapLeft) / oldZoom;
        const cursorY = (e.clientY - wrapperRect.top + wrapper.scrollTop - mapTop) / oldZoom;

        // Apply transform + label directly (skip updatePanMode to avoid layout thrashing)
        _dom.storyMap.style.transform = `scale(${zoomLevel})`;
        _dom.storyMap.style.setProperty('--zoom', zoomLevel);
        _dom.zoomReset.textContent = `${Math.round(zoomLevel * 100)}%`;
        updateZoomScrollBounds();

        // Scroll so the same content point stays under the cursor
        wrapper.scrollLeft = mapLeft + cursorX * zoomLevel - (e.clientX - wrapperRect.left);
        wrapper.scrollTop = mapTop + cursorY * zoomLevel - (e.clientY - wrapperRect.top);

        // Defer pan mode update to next frame
        requestAnimationFrame(() => {
            updatePanMode();
        });
    }, { passive: false });
};

export const initPinchZoom = () => {
    const wrapper = _dom.storyMapWrapper;
    // Prevent browser pinch-zoom while allowing single-finger scroll
    wrapper.style.touchAction = 'pan-x pan-y';

    let startDist = 0;
    let startZoom = 1;

    const getTouchDist = (t1, t2) =>
        Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

    wrapper.addEventListener('touchstart', (e) => {
        if (e.touches.length >= 2) {
            isPinching = true;
            startDist = getTouchDist(e.touches[0], e.touches[1]);
            startZoom = zoomLevel;
        }
    }, { passive: true });

    wrapper.addEventListener('touchmove', (e) => {
        if (!isPinching || e.touches.length < 2) return;
        e.preventDefault();

        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const newDist = getTouchDist(t0, t1);
        const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, startZoom * (newDist / startDist)));

        if (newZoom === zoomLevel) return;

        const wrapperRect = wrapper.getBoundingClientRect();
        const oldZoom = zoomLevel;

        // Midpoint of the two touches is the zoom anchor
        const midX = (t0.clientX + t1.clientX) / 2;
        const midY = (t0.clientY + t1.clientY) / 2;

        // Content-space coordinate under the midpoint
        const mapLeft = _dom.storyMap.offsetLeft;
        const mapTop = _dom.storyMap.offsetTop;
        const contentX = (midX - wrapperRect.left + wrapper.scrollLeft - mapLeft) / oldZoom;
        const contentY = (midY - wrapperRect.top + wrapper.scrollTop - mapTop) / oldZoom;

        zoomLevel = newZoom;
        _dom.storyMap.style.transform = `scale(${zoomLevel})`;
        _dom.storyMap.style.setProperty('--zoom', zoomLevel);
        _dom.zoomReset.textContent = `${Math.round(zoomLevel * 100)}%`;
        updateZoomScrollBounds();

        // Keep the midpoint stable
        wrapper.scrollLeft = mapLeft + contentX * zoomLevel - (midX - wrapperRect.left);
        wrapper.scrollTop = mapTop + contentY * zoomLevel - (midY - wrapperRect.top);
    }, { passive: false });

    const onTouchEnd = (e) => {
        if (isPinching && e.touches.length < 2) {
            isPinching = false;
            requestAnimationFrame(() => updatePanMode());
        }
    };
    wrapper.addEventListener('touchend', onTouchEnd, { passive: true });
    wrapper.addEventListener('touchcancel', onTouchEnd, { passive: true });

    // Suppress Safari's native gesture zoom (proprietary events fire alongside touch*)
    wrapper.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
};

// Zoom keeping the viewport center stable
const zoomAroundCenter = (newZoom) => {
    const wrapper = _dom.storyMapWrapper;
    const oldZoom = zoomLevel;
    const mapLeft = _dom.storyMap.offsetLeft;
    const mapTop = _dom.storyMap.offsetTop;

    // Content-space coordinate at viewport center
    const cx = (wrapper.scrollLeft + wrapper.clientWidth / 2 - mapLeft) / oldZoom;
    const cy = (wrapper.scrollTop + wrapper.clientHeight / 2 - mapTop) / oldZoom;

    zoomLevel = newZoom;
    updateZoom();

    // Scroll so the same content point stays at viewport center
    wrapper.scrollLeft = mapLeft + cx * zoomLevel - wrapper.clientWidth / 2;
    wrapper.scrollTop = mapTop + cy * zoomLevel - wrapper.clientHeight / 2;
};

export const zoomIn = () => {
    zoomAroundCenter(Math.min(ZOOM_MAX, zoomLevel + ZOOM_STEP));
};

export const zoomOut = () => {
    zoomAroundCenter(Math.max(ZOOM_MIN, zoomLevel - ZOOM_STEP));
};

export const zoomCycle = () => {
    const currentIndex = ZOOM_LEVELS.indexOf(zoomLevel);
    zoomAroundCenter(ZOOM_LEVELS[(currentIndex + 1) % ZOOM_LEVELS.length]);
};

// Marquee (rectangle) selection

const MARQUEE_SKIP_SELECTORS = '.step, .story-card, textarea, button, a, input, .options-menu, .btn-add-story, .btn-add-slice, .selection-toolbar, .slice-menu-dropdown, .slice-label-container';

const rectsIntersect = (a, b) =>
    !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);

const highlightIntersecting = (marqueeRect) => {
    const cards = _dom.storyMap.querySelectorAll('.step, .story-card, .step-placeholder:not(.phantom-step)');
    for (const card of cards) {
        const cardRect = card.getBoundingClientRect();
        card.classList.toggle('marquee-preview', rectsIntersect(marqueeRect, cardRect));
    }
};

const finalizeMarqueeSelection = () => {
    const entries = [];
    const spacerEntries = [];
    for (const elem of _dom.storyMap.querySelectorAll('.marquee-preview')) {
        elem.classList.remove('marquee-preview');
        const columnId = elem.dataset.columnId;
        if (elem.classList.contains('step')) {
            entries.push({ columnId, type: 'step' });
        } else if (elem.classList.contains('story-card')) {
            entries.push({ columnId, type: 'story', storyId: elem.dataset.storyId, sliceId: elem.dataset.sliceId });
        } else if (elem.classList.contains('step-placeholder')) {
            spacerEntries.push({ columnId, type: 'step' });
        }
    }
    // Use spacers only when no real cards are in the selection
    const result = entries.length > 0 ? entries : spacerEntries;
    if (result.length === 0) return;

    _selection.clickedCards = result;
    _selection.columnIds = [...new Set(result.map(e => e.columnId))];
    _selection.anchorId = _selection.columnIds[0];
    _updateSelectionUI();
};

export const initMarquee = () => {
    const wrapper = _dom.storyMapWrapper;

    wrapper.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (!_isMapEditable()) return;
        if (window.matchMedia('(pointer: coarse)').matches) return;
        if (e.target.closest(MARQUEE_SKIP_SELECTORS)) return;

        e.preventDefault();
        marqueeStartX = e.clientX;
        marqueeStartY = e.clientY;
        mousedownTarget = e.target;
        didMarquee = false;
    });

    document.addEventListener('mousemove', (e) => {
        if (mousedownTarget === null || isPanning) return;

        const dx = e.clientX - marqueeStartX;
        const dy = e.clientY - marqueeStartY;

        if (!isMarquee && Math.abs(dx) < MARQUEE_THRESHOLD && Math.abs(dy) < MARQUEE_THRESHOLD) return;

        if (!isMarquee) {
            isMarquee = true;
            didMarquee = true;
            marqueeEl = document.createElement('div');
            marqueeEl.className = 'marquee-rect';
            document.body.appendChild(marqueeEl);
            wrapper.classList.add('marquee-active');
            _clearSelection();
            _updateSelectionUI();
        }

        const left = Math.min(marqueeStartX, e.clientX);
        const top = Math.min(marqueeStartY, e.clientY);
        const width = Math.abs(dx);
        const height = Math.abs(dy);

        marqueeEl.style.left = left + 'px';
        marqueeEl.style.top = top + 'px';
        marqueeEl.style.width = width + 'px';
        marqueeEl.style.height = height + 'px';

        if (marqueeRaf) cancelAnimationFrame(marqueeRaf);
        marqueeRaf = requestAnimationFrame(() => {
            highlightIntersecting({ left, top, right: left + width, bottom: top + height });
        });
    });

    document.addEventListener('mouseup', (e) => {
        if (mousedownTarget === null) return;

        if (isMarquee) {
            finalizeMarqueeSelection();
            if (marqueeEl) marqueeEl.remove();
            marqueeEl = null;
            wrapper.classList.remove('marquee-active');
            isMarquee = false;
            if (marqueeRaf) { cancelAnimationFrame(marqueeRaf); marqueeRaf = null; }
            // Suppress the click event that follows mouseup so it doesn't clear the selection
            document.addEventListener('click', (ev) => ev.stopPropagation(), { capture: true, once: true });
        } else if (!e.target.closest(MARQUEE_SKIP_SELECTORS)) {
            _clearSelection();
            _updateSelectionUI();
        }

        mousedownTarget = null;
    });
};

