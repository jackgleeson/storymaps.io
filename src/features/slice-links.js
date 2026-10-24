// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Slice links (#slice-<id>), slice goal and target date

import { dom } from '/src/ui/dom.js';
import { el, normalizeSliceGoal, normalizeSliceDate, SLICE_GOAL_MAX_LENGTH } from '/src/core/constants.js';
import { showPrompt, showToast } from '/src/core/modals.js';
import { quoted } from '/src/core/log.js';

let _deps = {};

export const init = (deps) => { _deps = deps; };

// Collapsed slices opened from a link. They show expanded for this viewer only, so following a
// link doesn't reopen a finished slice for everyone else on the map.
const _peekedSliceIds = new Set();
export const isSlicePeeked = (sliceId) => _peekedSliceIds.has(sliceId);
export const unpeekSlice = (sliceId) => _peekedSliceIds.delete(sliceId);

const SLICE_HASH = /^#slice-([A-Za-z0-9_-]+)$/;

export const sliceLinkUrl = (slice) =>
    `${window.location.origin}/${encodeURIComponent(_deps.state.mapId)}#slice-${slice.id}`;

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

// Dim everything except the slice for a moment so it's obvious which slice the link meant
const spotlight = (sliceEl) => {
    const map = dom.storyMap;
    clearTimeout(_spotlightTimer);
    map.querySelectorAll('.slice-spotlight-target').forEach(e => e.classList.remove('slice-spotlight-target'));
    sliceEl.classList.add('slice-spotlight-target');
    map.classList.add('slice-spotlight', 'slice-spotlight-on');
    _spotlightTimer = setTimeout(() => {
        map.classList.remove('slice-spotlight-on');
        _spotlightTimer = setTimeout(() => {
            map.classList.remove('slice-spotlight');
            sliceEl.classList.remove('slice-spotlight-target');
        }, 600);
    }, 1600);
};

// Scroll so the slice's top-left corner sits near the top-left of the map area
const scrollToSlice = (sliceEl) => {
    const wrapper = dom.storyMapWrapper;
    const rect = sliceEl.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    const padding = 24;
    wrapper.scrollTop += rect.top - wrapperRect.top - padding;
    if (rect.left < wrapperRect.left || rect.left > wrapperRect.left + wrapperRect.width / 2) {
        wrapper.scrollLeft += rect.left - wrapperRect.left - padding;
    }
};

// Scroll to and spotlight the slice named in the URL fragment, if there is one
export const revealSliceFromHash = () => {
    const match = window.location.hash.match(SLICE_HASH);
    if (!match) return;
    const slice = _deps.state.slices.find(s => s.id === match[1]);
    if (!slice) {
        showToast('That slice is no longer in this map');
        return;
    }
    if (slice.collapsed && !_peekedSliceIds.has(slice.id)) {
        _peekedSliceIds.add(slice.id);
        _deps.rerenderSlice(slice.id);
    }
    const sliceEl = dom.storyMap.querySelector(`.slice-container[data-slice-id="${slice.id}"]`);
    if (!sliceEl) return;
    scrollToSlice(sliceEl);
    spotlight(sliceEl);
};

// =============================================================================
// Goal and target date
// =============================================================================

export const formatSliceDate = (isoDate) =>
    new Date(`${isoDate}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

let _floating = null;
let _floatingAnchor = null;

const closeFloating = () => {
    if (!_floating) return;
    _floating.remove();
    _floating = null;
    _floatingAnchor = null;
    document.removeEventListener('mousedown', onOutsidePointer, { capture: true });
    document.removeEventListener('touchstart', onOutsidePointer, { capture: true });
    document.removeEventListener('keydown', onFloatingKey, { capture: true });
    dom.storyMapWrapper.removeEventListener('scroll', closeFloating);
};

const onOutsidePointer = (e) => {
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
const showFloating = (panel, anchor) => {
    closeFloating();
    _floating = panel;
    _floatingAnchor = anchor;
    document.body.appendChild(panel);

    const a = anchor.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    const margin = 8;
    let left = a.right + 6;
    if (left + p.width > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - p.width - margin);
    let top = a.top;
    if (top + p.height > window.innerHeight - margin) top = Math.max(margin, window.innerHeight - p.height - margin);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;

    setTimeout(() => {
        if (_floating !== panel) return;
        document.addEventListener('mousedown', onOutsidePointer, { capture: true });
        document.addEventListener('touchstart', onOutsidePointer, { capture: true });
        document.addEventListener('keydown', onFloatingKey, { capture: true });
        dom.storyMapWrapper.addEventListener('scroll', closeFloating);
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

// The ⓘ in the slice gutter. Hover or focus shows the goal and date; a tap toggles them.
export const createSliceInfo = (slice) => {
    if (!slice.goal && !slice.targetDate) return null;
    const btn = el('button', 'slice-info', { text: 'i', ariaLabel: 'Slice goal and target date' });
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

// Swap the gutter's ⓘ after the goal or date changes, without rebuilding the slice
const refreshSliceInfo = (slice) => {
    const container = dom.storyMap.querySelector(`.slice-label-container[data-slice-id="${slice.id}"]`);
    if (!container) return;
    container.querySelector('.slice-info')?.remove();
    const info = createSliceInfo(slice);
    if (info) container.querySelector('.slice-label')?.after(info);
};

// Popover for editing a slice's goal and target date, opened from the slice menus
export const openSliceDetails = (slice, anchor) => {
    // A remote change or undo replaces the slice objects, so always edit the current one
    const sliceId = slice.id;
    const current = () => _deps.state.slices.find(s => s.id === sliceId);
    const panel = el('div', 'slice-floating slice-details', { role: 'dialog', ariaLabel: 'Slice details' });
    const title = el('div', 'slice-details-title', { text: slice.name ? `Details for ${slice.name}` : 'Slice details' });

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
        refreshSliceInfo(target);
        _deps.saveToStorage();
    };

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

    panel.append(title, goalLabel, dateLabel);
    showFloating(panel, anchor);
    goal.focus();
};

export const closeSliceFloating = closeFloating;
