// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Card detail expand modal

import { dom } from '/src/ui/dom.js';
import { pushUndo } from '/src/core/state.js';
import { isMapEditable } from '/src/core/lock.js';
import * as log from '/src/core/log.js';
import { CARD_COLORS, STATUS_OPTIONS, el, isValidUrl } from '/src/core/constants.js';
import { createPointsInput, createTagEditor, patchCardForItem } from '/src/ui/ui.js';

let _deps = {};

export const init = (deps) => { _deps = deps; };

let _expandedItem = null;
let _closingExpandViaBack = false;
let _poppingExpandState = false;

export const getExpandedItem = () => _expandedItem;
export const isPoppingExpandState = () => _poppingExpandState;
export const clearPoppingExpandState = () => { _poppingExpandState = false; };

const autoResizeExpandName = () => {
    dom.cardExpandName.style.height = 'auto';
    dom.cardExpandName.style.height = dom.cardExpandName.scrollHeight + 'px';
};

// Fit the body to its text; CSS min-height and max-height keep it between a few lines and 60vh
const autoResizeExpandBody = () => {
    dom.cardExpandBody.style.height = 'auto';
    dom.cardExpandBody.style.height = dom.cardExpandBody.scrollHeight + 'px';
};

// Footer icons, one per property row
const ICONS = {
    status: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>',
    points: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 9h14M5 15h14M10 4L8 20M16 4l-2 16"/></svg>',
    tags: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5" fill="currentColor"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    colour: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/></svg>'
};

const statusDot = (status) => {
    const dot = el('span', 'card-expand-status-dot');
    dot.style.backgroundColor = STATUS_OPTIONS[status].color;
    return dot;
};

const buildStatusField = (item, editable, onChange) => {
    if (!editable) {
        if (!STATUS_OPTIONS[item.status]) return null;
        const chip = el('span', 'card-expand-status-option selected');
        chip.append(statusDot(item.status), el('span', null, { text: STATUS_OPTIONS[item.status].label }));
        return chip;
    }
    const row = el('div', 'card-expand-status');
    const options = [el('button', 'card-expand-status-none', { text: '×', title: 'No status', ariaLabel: 'No status', dataStatus: '' })];
    Object.entries(STATUS_OPTIONS).forEach(([key, { label }]) => {
        // Title and aria-label because narrow screens hide the text of unselected options
        const option = el('button', 'card-expand-status-option', { dataStatus: key, title: label, ariaLabel: label });
        option.append(statusDot(key), el('span', null, { text: label }));
        options.push(option);
    });
    const markSelected = () => options.forEach(o => o.classList.toggle('selected', o.dataset.status === (item.status || '')));
    options.forEach(option => {
        option.addEventListener('click', () => {
            const status = option.dataset.status || null;
            if ((item.status || null) === status) return;
            pushUndo();
            item.status = status;
            log.logEvent(`Changed card status${log.quoted(item.name)}`, [item.id]);
            markSelected();
            onChange();
        });
    });
    markSelected();
    row.append(...options);
    return row;
};

const buildPointsField = (item, editable, onChange) => {
    if (!editable) {
        if (item.points == null) return null;
        return el('span', 'card-expand-readonly-text', { text: `${item.points} ${item.points === 1 ? 'pt' : 'pts'}` });
    }
    const wrap = el('label', 'card-expand-points');
    const input = createPointsInput(item, onChange, 'card-expand-points-input');
    input.setAttribute('aria-label', 'Points');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    wrap.append(input, el('span', null, { text: 'pts' }));
    return wrap;
};

const buildTagsField = (item, editable, onChange) => {
    const row = el('div', 'card-expand-tags');
    if (!editable) {
        if (!item.tags?.length) return null;
        item.tags.forEach(tag => {
            const pill = el('span', 'tag-pill');
            pill.appendChild(el('span', null, { text: tag }));
            row.appendChild(pill);
        });
        return row;
    }
    const editor = createTagEditor(item, onChange, { inputClass: 'card-expand-tag-input' });
    row.append(editor.list, editor.inputWrapper);
    return row;
};

const buildLinkField = (item, editable, onChange) => {
    if (!editable) {
        if (!isValidUrl(item.url)) return null;
        return el('a', 'card-expand-link', { href: item.url, target: '_blank', rel: 'noopener noreferrer', text: item.url });
    }
    const wrap = el('div', 'card-expand-link-field');
    const input = el('input', 'card-expand-link-input', { type: 'url', placeholder: 'https://...', value: item.url || '', ariaLabel: 'Link' });
    const error = el('div', 'card-expand-link-error', { text: 'Use a link starting with http:// or https://' });
    error.hidden = true;
    input.addEventListener('input', () => {
        input.classList.remove('invalid');
        error.hidden = true;
    });
    input.addEventListener('change', () => {
        const url = input.value.trim();
        if (url && !isValidUrl(url)) {
            input.classList.add('invalid');
            error.hidden = false;
            return;
        }
        if (url === (item.url || '')) return;
        pushUndo();
        item.url = url || null;
        log.logEvent(`${url ? 'Added card URL' : 'Removed card URL'}${log.quoted(item.name)}`, [item.id]);
        onChange();
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    wrap.append(input, error);
    return wrap;
};

const buildColourField = (item, editable, onChange) => {
    if (!editable) return null;
    const row = el('div', 'card-expand-swatches');
    const swatches = Object.entries(CARD_COLORS).map(([name, hex]) => {
        const swatch = el('button', 'card-expand-swatch', { title: name, ariaLabel: name, dataColor: hex.toLowerCase() });
        swatch.style.backgroundColor = hex;
        swatch.addEventListener('click', () => {
            if (item.color?.toLowerCase() === swatch.dataset.color) return;
            pushUndo();
            item.color = hex;
            log.logEvent(`Changed card color${log.quoted(item.name)}`, [item.id]);
            dom.cardExpandModal.querySelector('.card-expand-modal').style.backgroundColor = hex;
            swatches.forEach(s => s.classList.toggle('selected', s === swatch));
            onChange();
        });
        swatch.classList.toggle('selected', item.color?.toLowerCase() === swatch.dataset.color);
        return swatch;
    });
    row.append(...swatches);
    return row;
};

// Status, points, tags, link and colour, the same properties as the card's ... menu.
// A locked map shows only the values that are set, and no footer if none are.
const renderFooter = (item, editable) => {
    const footer = dom.cardExpandFooter;
    footer.innerHTML = '';
    const onChange = () => {
        patchCardForItem(item);
        _deps.saveToStorage();
    };
    const addRow = (label, icon, field) => {
        if (!field) return;
        footer.append(el('span', 'card-expand-field-icon', { title: label, ariaLabel: label, html: icon }), field);
    };
    addRow('Status', ICONS.status, buildStatusField(item, editable, onChange));
    addRow('Points', ICONS.points, buildPointsField(item, editable, onChange));
    addRow('Tags', ICONS.tags, buildTagsField(item, editable, onChange));
    addRow('Link', ICONS.link, buildLinkField(item, editable, onChange));
    addRow('Colour', ICONS.colour, buildColourField(item, editable, onChange));
    footer.hidden = footer.children.length === 0;
};

export const openExpandModal = (item, { readOnly = false } = {}) => {
    // If a previous close is still waiting for its popstate, absorb it now
    if (_poppingExpandState) {
        _poppingExpandState = false;
    }
    _expandedItem = item;
    const editable = !readOnly && isMapEditable();
    dom.cardExpandName.value = item.name || '';
    dom.cardExpandBody.value = item.body || '';
    dom.cardExpandName.readOnly = !editable;
    dom.cardExpandBody.readOnly = !editable;
    const modal = dom.cardExpandModal.querySelector('.card-expand-modal');
    if (modal) modal.style.backgroundColor = item.color || '';
    renderFooter(item, editable);
    dom.cardExpandModal.classList.add('visible');
    requestAnimationFrame(() => {
        autoResizeExpandName();
        autoResizeExpandBody();
    });
    if (editable) {
        dom.cardExpandName.focus();
        pushUndo();
    }
    history.pushState({ cardExpand: true }, '');
};

export const closeExpandModal = () => {
    if (!dom.cardExpandModal.classList.contains('visible')) return;
    // Points and link save on change, which fires on blur. iOS Safari doesn't blur a field when you
    // tap something unfocusable like the close button or backdrop, so blur it here to save it first.
    if (dom.cardExpandModal.contains(document.activeElement)) document.activeElement.blur();
    dom.cardExpandModal.classList.remove('visible');
    _expandedItem = null;
    _deps.renderAndSave();
    // Pop the history entry we pushed on open, unless we got here via back button
    if (!_closingExpandViaBack) {
        _poppingExpandState = true;
        history.back();
    }
};

// Called by popstate handler to close via back button
export const closeExpandViaBack = () => {
    _closingExpandViaBack = true;
    closeExpandModal();
    _closingExpandViaBack = false;
};

export const initListeners = () => {
    dom.cardExpandName.addEventListener('input', () => {
        if (!_expandedItem) return;
        _expandedItem.name = dom.cardExpandName.value;
        log.logTextEdit('card title', _expandedItem.id);
        autoResizeExpandName();
        _deps.saveToStorage();
    });

    dom.cardExpandBody.addEventListener('input', () => {
        if (!_expandedItem) return;
        _expandedItem.body = dom.cardExpandBody.value;
        log.logTextEdit('card body', _expandedItem.id);
        autoResizeExpandBody();
        _deps.saveToStorage();
    });

    document.getElementById('cardExpandModalClose')?.addEventListener('click', closeExpandModal);
    dom.cardExpandModal.addEventListener('click', (e) => {
        if (e.target === dom.cardExpandModal) closeExpandModal();
    });
};
