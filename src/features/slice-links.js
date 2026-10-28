// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Slice links (#slice-<name>-<id>), slice goal and target date

import { dom } from '/src/ui/dom.js';
import { el, normalizeSliceGoal, normalizeSliceDate, SLICE_GOAL_MAX_LENGTH } from '/src/core/constants.js';
import { showPrompt, showToast } from '/src/core/modals.js';
import { quoted, logTextEdit } from '/src/core/log.js';
import { parseLocation, projectPath } from '/src/core/project-links.js';
import { sliceHash, sliceFromHash } from '/src/core/slice-hash.js';
import { frozenRowsHeight } from '/src/features/freeze-rows.js';

let _deps = {};

export const init = (deps) => { _deps = deps; };

// A map open in a project links to the slice at the project link, so the tabs come with it
export const sliceLinkUrl = (slice) => {
    const mapId = _deps.state.mapId;
    const { projectId, mapId: shownMap } = parseLocation(window.location.pathname);
    const path = projectId && shownMap === mapId ? projectPath(projectId, mapId) : `/${encodeURIComponent(mapId)}`;
    return `${window.location.origin}${path}${sliceHash(slice)}`;
};

export const copySliceLink = async (slice) => {
    const url = sliceLinkUrl(slice);
    try {
        await navigator.clipboard.writeText(url);
        showToast('Link copied');
    } catch {
        await showPrompt('Copy this link to the slice:', url);
    }
};

// =============================================================================
// Opening a link
// =============================================================================

let _spotlightTimer = null;
let _cancelScroll = null;
let _revealTimer = null;

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Dim everything except the slice so it's obvious which slice the link meant
const startSpotlight = (sliceEl) => {
    const map = dom.storyMap;
    clearTimeout(_spotlightTimer);
    _cancelScroll?.();
    map.querySelectorAll('.slice-spotlight-target').forEach(e => e.classList.remove('slice-spotlight-target', 'slice-spotlight-land'));
    sliceEl.classList.add('slice-spotlight-target');
    map.classList.add('slice-spotlight', 'slice-spotlight-on');
};

// Once the scroll lands, flash the slice's top edge, then bring the rest of the map back
const endSpotlight = (sliceEl) => {
    const map = dom.storyMap;
    sliceEl.classList.add('slice-spotlight-land');
    _spotlightTimer = setTimeout(() => {
        map.classList.remove('slice-spotlight-on');
        _spotlightTimer = setTimeout(() => {
            map.classList.remove('slice-spotlight');
            sliceEl.classList.remove('slice-spotlight-target', 'slice-spotlight-land');
        }, 600);
    }, 1400);
};

const easeInOutCubic = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// Ease the wrapper to a scroll position. Any wheel, touch, click or key from the viewer stops it.
const animateScroll = (wrapper, top, left, onDone) => {
    _cancelScroll?.();
    top = Math.max(0, Math.min(top, wrapper.scrollHeight - wrapper.clientHeight));
    left = Math.max(0, Math.min(left, wrapper.scrollWidth - wrapper.clientWidth));
    const fromTop = wrapper.scrollTop;
    const fromLeft = wrapper.scrollLeft;
    const distance = Math.hypot(top - fromTop, left - fromLeft);
    if (distance < 2 || prefersReducedMotion()) {
        wrapper.scrollTop = top;
        wrapper.scrollLeft = left;
        onDone();
        return;
    }
    // Longer trips take a little longer, but never drag on
    const duration = Math.min(1100, Math.max(450, 300 + distance * 0.35));
    const start = performance.now();
    let frame = null;
    const userEvents = ['wheel', 'touchstart', 'mousedown', 'keydown'];
    const stop = () => {
        cancelAnimationFrame(frame);
        userEvents.forEach(type => wrapper.removeEventListener(type, interrupt));
        if (_cancelScroll === stop) _cancelScroll = null;
    };
    // The viewer taking over still ends the spotlight; a newer link replaces it instead
    const interrupt = () => {
        stop();
        onDone();
    };
    userEvents.forEach(type => wrapper.addEventListener(type, interrupt, { passive: true }));
    _cancelScroll = stop;
    const step = (now) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = easeInOutCubic(t);
        wrapper.scrollTop = fromTop + (top - fromTop) * eased;
        wrapper.scrollLeft = fromLeft + (left - fromLeft) * eased;
        if (t < 1) {
            frame = requestAnimationFrame(step);
        } else {
            stop();
            onDone();
        }
    };
    frame = requestAnimationFrame(step);
};

// Scroll so the slice's top-left corner sits near the top-left of the map area, below any rows
// kept in view
const scrollToSlice = (sliceEl, onDone) => {
    const wrapper = dom.storyMapWrapper;
    const rect = sliceEl.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    const padding = 24;
    const top = wrapper.scrollTop + rect.top - wrapperRect.top - padding - frozenRowsHeight();
    let left = wrapper.scrollLeft;
    if (rect.left < wrapperRect.left || rect.left > wrapperRect.left + wrapperRect.width / 2) {
        left += rect.left - wrapperRect.left - padding;
    }
    animateScroll(wrapper, top, left, onDone);
};

// Scroll to and spotlight the slice named in the URL fragment, if there is one.
// delay lets a freshly opened map show where it starts before the scroll begins.
export const revealSliceFromHash = (delay = 0) => {
    const slice = sliceFromHash(window.location.hash, _deps.state.slices);
    if (slice === undefined) return;
    if (!slice) {
        showToast('That slice is no longer in this map');
        return;
    }
    const sliceEl = dom.storyMap.querySelector(`.slice-container[data-slice-id="${slice.id}"]`);
    if (!sliceEl) return;
    startSpotlight(sliceEl);
    clearTimeout(_revealTimer);
    _revealTimer = setTimeout(() => {
        if (sliceEl.isConnected) scrollToSlice(sliceEl, () => endSpotlight(sliceEl));
    }, delay);
};

// =============================================================================
// Goal and target date
// =============================================================================

export const formatSliceDate = (isoDate) =>
    new Date(`${isoDate}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

let _floating = null;
let _floatingAnchor = null;
let _backdrop = null;

// Phones get the details as a sheet across the top of the screen, clear of the keyboard
const useSheet = () => window.matchMedia('(max-width: 600px)').matches;

const closeFloating = () => {
    if (!_floating) return;
    _floating.remove();
    _backdrop?.remove();
    _floating = null;
    _floatingAnchor = null;
    _backdrop = null;
    document.removeEventListener('mousedown', onOutsidePointer, { capture: true });
    document.removeEventListener('touchstart', onOutsidePointer, { capture: true });
    document.removeEventListener('keydown', onFloatingKey, { capture: true });
    dom.storyMapWrapper.removeEventListener('scroll', closeFloating);
};

const onOutsidePointer = (e) => {
    // The sheet's backdrop closes on click, so the tap doesn't land on the map underneath
    if (e.target === _backdrop) return;
    if (_floating?.contains(e.target) || _floatingAnchor?.contains(e.target)) return;
    closeFloating();
};

const onFloatingKey = (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    const anchor = _floatingAnchor;
    closeFloating();
    if (anchor?.isConnected && anchor.matches('button')) anchor.focus();
};

// Floating panels live on <body>, outside the zoomed map, so they stay readable at any zoom level
const showFloating = (panel, anchor, { sheet = false } = {}) => {
    closeFloating();
    _floating = panel;
    _floatingAnchor = anchor;
    if (sheet) {
        _backdrop = el('div', 'slice-sheet-backdrop');
        _backdrop.addEventListener('click', closeFloating);
        document.body.appendChild(_backdrop);
        panel.classList.add('slice-sheet');
    }
    document.body.appendChild(panel);

    if (!sheet) {
        const a = anchor.getBoundingClientRect();
        const p = panel.getBoundingClientRect();
        const margin = 8;
        let left = a.right + 6;
        if (left + p.width > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - p.width - margin);
        let top = a.top;
        if (top + p.height > window.innerHeight - margin) top = Math.max(margin, window.innerHeight - p.height - margin);
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
    }

    setTimeout(() => {
        if (_floating !== panel) return;
        document.addEventListener('mousedown', onOutsidePointer, { capture: true });
        document.addEventListener('touchstart', onOutsidePointer, { capture: true });
        document.addEventListener('keydown', onFloatingKey, { capture: true });
        // The keyboard opening can scroll the page under a sheet, so only popovers close on scroll
        if (!sheet) dom.storyMapWrapper.addEventListener('scroll', closeFloating);
    });
};

const buildDetailsTip = (slice) => {
    const tip = el('div', 'slice-floating slice-info-tip', { role: 'tooltip' });
    const list = el('dl');
    if (slice.goal) list.append(el('dt', null, { text: 'Goal' }), el('dd', null, { text: slice.goal }));
    if (slice.targetDate) list.append(el('dt', null, { text: 'Target date' }), el('dd', null, { text: formatSliceDate(slice.targetDate) }));
    tip.appendChild(list);
    return tip;
};

// The ⓘ for a slice's goal and date. Hover or focus shows them; a tap toggles them.
export const createSliceInfo = (slice, extraClass = '') => {
    if (!slice.goal && !slice.targetDate) return null;
    const btn = el('button', `slice-info ${extraClass}`.trim(), { text: 'i', ariaLabel: 'Slice goal and target date' });
    let pinned = false;
    const show = () => {
        if (_floatingAnchor === btn) return;
        showFloating(buildDetailsTip(slice), btn);
    };
    const hide = () => {
        if (!pinned && _floatingAnchor === btn) closeFloating();
    };
    btn.addEventListener('mouseenter', show);
    btn.addEventListener('mouseleave', hide);
    btn.addEventListener('focus', show);
    btn.addEventListener('blur', () => { pinned = false; hide(); });
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        pinned = !pinned || _floatingAnchor !== btn;
        if (pinned) show();
        else closeFloating();
    });
    return btn;
};

// The name in the gutter, with a placeholder from CSS when the slice has no name yet
export const setSliceNameText = (nameEl, name) => {
    nameEl.textContent = name || '';
    nameEl.classList.toggle('slice-label-empty', !name);
};

// Update the slice's name and ⓘ after an edit, without rebuilding the slice
const refreshSliceGutter = (slice) => {
    const container = dom.storyMap.querySelector(`.slice-container[data-slice-id="${slice.id}"]`);
    if (!container) return;
    const nameEl = container.querySelector('.slice-label');
    if (nameEl) setSliceNameText(nameEl, slice.name);
    container.querySelectorAll('.slice-info').forEach(info => info.remove());
    if (!slice.goal && !slice.targetDate) return;
    if (!container.classList.contains('slice-collapsed')) {
        nameEl?.after(createSliceInfo(slice));
        return;
    }
    // Collapsed slices have the ⓘ before the menu, and in the banner for narrow screens
    container.querySelector('.slice-controls-row .slice-menu')?.before(createSliceInfo(slice, 'slice-info-gutter'));
    container.querySelector('.slice-completed-banner')?.appendChild(createSliceInfo(slice, 'slice-info-banner'));
};

// Panel for a slice's name, goal and target date, opened from the slice name or the slice menus
export const openSliceDetails = (slice, anchor) => {
    // A second click on what opened the panel closes it
    if (_floatingAnchor === anchor && _floating?.classList.contains('slice-details')) return closeFloating();

    // A remote change or undo replaces the slice objects, so always edit the current one
    const sliceId = slice.id;
    const current = () => _deps.state.slices.find(s => s.id === sliceId);
    const original = { name: slice.name || '', goal: slice.goal, targetDate: slice.targetDate };
    const panel = el('div', 'slice-floating slice-details', { role: 'dialog', ariaLabel: 'Slice details' });
    const title = el('div', 'slice-details-title');
    const setTitle = (name) => { title.textContent = name.trim() ? `Details for ${name.trim()}` : 'Slice details'; };
    setTitle(original.name);

    let undoPushed = false;
    // Undo is pushed before the first edit, while the slice still has its old values
    const edit = (apply, logText) => {
        const target = current();
        if (!target) return closeFloating();
        if (!undoPushed) {
            _deps.pushUndo();
            undoPushed = true;
        }
        apply(target);
        if (logText) _deps.logEvent(`${logText}${quoted(target.name)}`, [sliceId]);
        refreshSliceGutter(target);
        _deps.saveToStorage();
    };

    const nameLabel = el('label', 'slice-details-label', { text: 'Name' });
    const name = el('textarea', 'slice-details-name', { rows: 1, placeholder: 'Release...', value: original.name });
    nameLabel.appendChild(name);
    // Names can run to a few lines, so the field grows with them
    const fitName = () => {
        name.style.height = 'auto';
        name.style.height = `${name.scrollHeight + name.offsetHeight - name.clientHeight}px`;
    };
    name.addEventListener('input', () => {
        edit(target => { target.name = name.value; });
        logTextEdit('slice name', sliceId);
        setTitle(name.value);
        fitName();
    });
    name.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            goal.focus();
        }
    });

    const goalLabel = el('label', 'slice-details-label', { text: 'Goal' });
    const goal = el('textarea', 'slice-details-goal', {
        rows: 2,
        maxLength: SLICE_GOAL_MAX_LENGTH,
        placeholder: 'What this slice delivers',
        value: slice.goal || ''
    });
    goalLabel.appendChild(goal);
    goal.addEventListener('input', () => edit(target => {
        const value = normalizeSliceGoal(goal.value);
        if (value) target.goal = value;
        else delete target.goal;
    }));
    goal.addEventListener('change', () => _deps.logEvent(`Changed slice goal${quoted(current()?.name)}`, [sliceId]));
    goal.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            date.focus();
        }
    });

    const dateLabel = el('label', 'slice-details-label', { text: 'Target date' });
    const dateRow = el('div', 'slice-details-date-row');
    const date = el('input', 'slice-details-date', { type: 'date', value: slice.targetDate || '' });
    const clear = el('button', 'slice-details-clear', { text: 'Clear', type: 'button' });
    clear.hidden = !slice.targetDate;
    const setDate = (value) => {
        value = normalizeSliceDate(value);
        if (value === (current()?.targetDate || '')) return;
        clear.hidden = !value;
        edit(target => {
            if (value) target.targetDate = value;
            else delete target.targetDate;
        }, value ? 'Set slice target date' : 'Removed slice target date');
    };
    date.addEventListener('change', () => setDate(date.value));
    clear.addEventListener('click', () => {
        date.value = '';
        setDate('');
    });
    dateRow.append(date, clear);
    dateLabel.appendChild(dateRow);

    // Changes save as they're made, so ✓ just closes the panel and ✕ puts the old values back
    const actions = el('div', 'slice-details-actions');
    const cancel = el('button', 'slice-label-cancel', { text: '✕', type: 'button', title: 'Cancel', ariaLabel: 'Undo changes and close' });
    const done = el('button', 'slice-label-save', { text: '✓', type: 'button', title: 'Done', ariaLabel: 'Done editing slice details' });
    cancel.addEventListener('click', () => {
        const target = current();
        if (target && undoPushed) {
            target.name = original.name;
            if (original.goal) target.goal = original.goal;
            else delete target.goal;
            if (original.targetDate) target.targetDate = original.targetDate;
            else delete target.targetDate;
            refreshSliceGutter(target);
            _deps.saveToStorage();
        }
        closeFloating();
    });
    done.addEventListener('click', closeFloating);
    actions.append(cancel, done);

    panel.append(title, nameLabel, goalLabel, dateLabel, actions);
    showFloating(panel, anchor, { sheet: useSheet() });
    fitName();
    name.focus();
    name.setSelectionRange(name.value.length, name.value.length);
};

export const closeSliceFloating = closeFloating;
