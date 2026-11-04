// Storymaps.io — AGPL-3.0 — see LICENCE for details
// UI component builders

import { CARD_COLORS, DEFAULT_CARD_COLORS, STATUS_OPTIONS, TITLE_MAX_LENGTH, el, isValidUrl } from '/src/core/constants.js';
import { createSlice, partialMapEditState } from '/src/core/state.js';
import { showAlert, showChoice, showConfirm, showPrompt } from '/src/core/modals.js';
import { quoted } from '/src/core/log.js';
import { copySliceLink, createSliceInfo, openSliceDetails, setSliceNameText } from '/src/features/slice-links.js';
import { frozenRowsHeight } from '/src/features/freeze-rows.js';
import { toggleSliceMenu } from '/src/ui/navigation.js';

let _state = null;
let _dom = null;
let _isMapEditable = null;
let _pushUndo = null;
let _addStory = null;
let _deleteColumn = null;
let _deleteStory = null;
let _deleteSlice = null;
let _saveToStorage = null;
let _renderAndSave = null;
let _scrollElementIntoView = null;
let _addColumn = null;
let _addSlice = null;
let _materializePhantomColumn = null;
let _handleColumnSelection = null;
let _startEditingPartial = null;
let _stopEditingPartial = null;
let _deletePartialMap = null;
let _restorePartialMap = null;
let _openExpandModal = null;
let _logEvent = null;
let _logTextEdit = null;
let _refilterCard = null;
let _initSortable = null;

export const PHANTOM_BUFFER = 3;

export const init = ({ state, isMapEditable, pushUndo, addStory, deleteColumn, deleteStory, deleteSlice, saveToStorage, renderAndSave, scrollElementIntoView, addColumn, addSlice, materializePhantomColumn, handleColumnSelection, startEditingPartial, stopEditingPartial, deletePartialMap, restorePartialMap, openExpandModal, logEvent, logTextEdit, refilterCard, initSortable }) => {
    _state = state;
    _dom = {
        storyMap: document.getElementById('storyMap'),
        legendPanel: document.getElementById('legendPanel'),
        legendToggle: document.getElementById('legendToggle'),
        legendEntries: document.getElementById('legendEntries'),
        legendAddBtn: document.getElementById('legendAddBtn'),
        legendBody: document.getElementById('legendBody'),
        controlsRight: document.getElementById('controlsRight'),
        partialsPanel: document.getElementById('partialsPanel'),
        partialsToggle: document.getElementById('partialsToggle'),
        partialsList: document.getElementById('partialsList'),
    };
    _isMapEditable = isMapEditable;
    _pushUndo = pushUndo;
    _addStory = addStory;
    _deleteColumn = deleteColumn;
    _deleteStory = deleteStory;
    _deleteSlice = deleteSlice;
    _saveToStorage = saveToStorage;
    _renderAndSave = renderAndSave;
    _scrollElementIntoView = scrollElementIntoView;
    _addColumn = addColumn;
    _addSlice = addSlice;
    _materializePhantomColumn = materializePhantomColumn;
    _handleColumnSelection = handleColumnSelection;
    _startEditingPartial = startEditingPartial;
    _stopEditingPartial = stopEditingPartial;
    _deletePartialMap = deletePartialMap;
    _restorePartialMap = restorePartialMap;
    _openExpandModal = openExpandModal;
    _logEvent = logEvent;
    _logTextEdit = logTextEdit;
    _refilterCard = refilterCard;
    _initSortable = initSortable;
};

const _getEditingPartialColIds = () => {
    if (!partialMapEditState.activeId) return null;
    return partialMapEditState.editingColIds.size > 0 ? partialMapEditState.editingColIds : null;
};

// Collect all unique tags used across the entire map
export const getAllTagsInMap = () => {
    const tags = new Set();
    _state.columns.forEach(c => (c.tags || []).forEach(t => tags.add(t)));
    Object.values(_state.users || {}).forEach(cards => {
        cards.forEach(s => (s.tags || []).forEach(t => tags.add(t)));
    });
    Object.values(_state.activities || {}).forEach(cards => {
        cards.forEach(s => (s.tags || []).forEach(t => tags.add(t)));
    });
    _state.slices.forEach(slice => {
        Object.values(slice.stories || {}).forEach(stories => {
            stories.forEach(s => (s.tags || []).forEach(t => tags.add(t)));
        });
    });
    (_state.partialMaps || []).forEach(pm => {
        (pm.columns || []).forEach(c => (c.tags || []).forEach(t => tags.add(t)));
        Object.values(pm.users || {}).forEach(cards => {
            cards.forEach(s => (s.tags || []).forEach(t => tags.add(t)));
        });
        Object.values(pm.activities || {}).forEach(cards => {
            cards.forEach(s => (s.tags || []).forEach(t => tags.add(t)));
        });
        Object.values(pm.stories || {}).forEach(sliceStories => {
            Object.values(sliceStories).forEach(cards => {
                cards.forEach(s => (s.tags || []).forEach(t => tags.add(t)));
            });
        });
    });
    return [...tags].sort((a, b) => a.localeCompare(b));
};

export const createDeleteBtn = (onConfirm, message) => {
    const btn = el('button', 'btn-delete', { html: '&#128465;', title: 'Delete', ariaLabel: 'Delete' });
    btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (await showConfirm(message)) onConfirm();
    });
    return btn;
};

// Actions for a slice, shared by its ☰ menu and the gutter's right-click menu. Copying a link
// works in locked maps; the rest change the map, so they're editOnly.
export const getSliceActions = (slice, anchor) => {
    const actions = [
        { key: 'details', label: 'Edit details', editOnly: true, run: () => openSliceDetails(slice, anchor) },
        { key: 'link', label: 'Copy link to slice', run: () => copySliceLink(slice) }
    ];
    const isOnlySlice = _state.slices.length === 1;
    if (slice.collapsed) {
        actions.push({ key: 'reopen', label: 'Reopen', editOnly: true, separator: true, run: () => toggleSliceCollapsed(slice.id, false) });
    } else if (!isOnlySlice) {
        actions.push(
            { key: 'complete', label: 'Mark Complete', editOnly: true, separator: true, run: () => markSliceComplete(slice) },
            { key: 'close', label: 'Close', editOnly: true, run: () => toggleSliceCollapsed(slice.id, true, 'closed') }
        );
    }
    if (!isOnlySlice) {
        actions.push({
            key: 'delete', label: 'Delete', editOnly: true, destructive: true,
            run: async () => {
                if (await showConfirm(`Delete "${slice.name || 'this slice'}" and all its stories?`)) _deleteSlice(slice.id);
            }
        });
    }
    return actions;
};

// Slice ☰ button. It opens the same menu as right-clicking the slice gutter.
export const createSliceMenu = (slice) => {
    const container = el('div', 'slice-menu');
    const btn = el('button', 'btn-slice-menu', { text: '☰', title: 'Slice options', ariaLabel: 'Slice options menu' });
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSliceMenu(slice.id, btn);
    });
    container.appendChild(btn);
    return container;
};

// Swap just one slice container instead of a full rebuild
const rerenderSlice = (sliceId) => {
    const index = _state.slices.findIndex(s => s.id === sliceId);
    const oldContainer = _dom.storyMap.querySelector(`.slice-container[data-slice-id="${sliceId}"]`);
    if (index === -1 || !oldContainer) return false;
    oldContainer.replaceWith(createSliceContainer(_state.slices[index], index));
    if (_initSortable) _initSortable();
    return true;
};

// Run a change that re-renders a slice, keeping the top of the slice where it was on screen.
// Otherwise the browser can keep a slice further down in place instead, which scrolls the
// changed slice up under the frozen rows. A slice that folds into a banner also comes down into
// view, in case its top was above the screen or under the frozen rows. Only the map area scrolls,
// and only up and down: scrollIntoView would also move the page sideways on phones.
const keepSliceInPlace = (sliceId, change) => {
    const container = () => _dom.storyMap.querySelector(`.slice-container[data-slice-id="${CSS.escape(sliceId)}"]`);
    const wrapper = _dom.storyMap.closest('.story-map-wrapper');
    const before = container()?.getBoundingClientRect().top;
    change();
    const after = container()?.getBoundingClientRect().top;
    if (!wrapper || before == null || after == null) return;
    wrapper.scrollTop += after - before;
    if (container().classList.contains('slice-collapsed')) {
        const visibleTop = wrapper.getBoundingClientRect().top + frozenRowsHeight();
        const top = container().getBoundingClientRect().top;
        if (top < visibleTop) wrapper.scrollTop -= visibleTop - top;
    }
};

// Toggle slice collapsed state
const toggleSliceCollapsed = (sliceId, collapsed, reason) => {
    const slice = _state.slices.find(s => s.id === sliceId);
    if (!slice) return;

    slice.collapsed = collapsed;
    if (collapsed && reason) slice.closedReason = reason;
    else delete slice.closedReason;
    _peekedSlices.delete(sliceId);
    // Partials a peek expanded stay expanded, so the cards in them stay in view
    _peekExpandedPartials.delete(sliceId);

    keepSliceInPlace(sliceId, () => {
        if (rerenderSlice(sliceId)) _saveToStorage();
        else _renderAndSave();
    });
};

// Cards in a slice with a status other than Done, and the list each one sits in, so they can be
// moved. Cards with no status are left alone, since some teams don't track status.
const isUnfinished = (card) => !!STATUS_OPTIONS[card.status] && card.status !== 'done';

// The partial maps placed in the map, once each. A partial can be placed more than once but
// stores its cards once, and while one is being edited its columns sit in the map itself, so it's
// left out.
const placedPartials = () => {
    const seen = new Set();
    return _state.columns.flatMap(col => {
        if (!col.partialMapId || col._editingHidden || seen.has(col.partialMapId)) return [];
        if (col.partialMapId === partialMapEditState.activeId) return [];
        seen.add(col.partialMapId);
        const pm = _state.partialMaps.find(p => p.id === col.partialMapId);
        return pm ? [pm] : [];
    });
};

// Every list of cards in a slice, once each: its own columns, then the columns of each partial
const sliceCardLists = (slice) => [
    ..._state.columns
        .filter(col => !col.partialMapId && !col._editingHidden)
        .map(col => ({ cards: slice.stories[col.id] || [], colId: col.id })),
    ...placedPartials().flatMap(pm => pm.columns.map(pmCol => ({ cards: pm.stories[slice.id]?.[pmCol.id] || [], colId: pmCol.id, pm }))),
];

const cardsInSlice = (slice) => sliceCardLists(slice).flatMap(l => l.cards);

const unfinishedSliceCards = (slice) => sliceCardLists(slice).flatMap(({ cards, colId, pm }) =>
    cards.filter(isUnfinished).map(card => ({ card, colId, pm })));

// Move cards to the top of the same columns in another slice, keeping their order
const moveCardsToSlice = (items, from, to) => {
    const lists = new Map();
    items.forEach(({ card, colId, pm }) => {
        const key = `${pm?.id || ''}:${colId}`;
        if (!lists.has(key)) lists.set(key, { colId, pm, cards: [] });
        lists.get(key).cards.push(card);
    });
    lists.forEach(({ colId, pm, cards }) => {
        const moving = new Set(cards);
        if (pm) {
            pm.stories[from.id][colId] = pm.stories[from.id][colId].filter(c => !moving.has(c));
            pm.stories[to.id] ??= {};
            pm.stories[to.id][colId] = [...cards, ...(pm.stories[to.id][colId] || [])];
        } else {
            from.stories[colId] = from.stories[colId].filter(c => !moving.has(c));
            to.stories[colId] = [...cards, ...(to.stories[colId] || [])];
        }
    });
};

// Mark a slice complete. When some cards aren't done, offer to move them to the next open slice,
// or to a new one after it, the way unfinished work usually carries into the next release.
const markSliceComplete = async (slice) => {
    const unfinished = unfinishedSliceCards(slice);
    if (unfinished.length === 0) {
        toggleSliceCollapsed(slice.id, true, 'complete');
        return;
    }
    const index = _state.slices.indexOf(slice);
    const target = _state.slices.slice(index + 1).find(s => !s.collapsed);
    const name = slice.name ? `"${slice.name}"` : 'this slice';
    const cards = unfinished.length === 1 ? '1 card' : `${unfinished.length} cards`;
    const destination = !target ? 'a new slice after it'
        : target.name ? `the top of "${target.name}"` : 'the top of the next slice';
    const choice = await showChoice(
        `${cards} in ${name} ${unfinished.length === 1 ? "isn't" : "aren't"} done. Move ${unfinished.length === 1 ? 'it' : 'them'} to ${destination}, then mark ${name} complete?`,
        { ok: 'Move and complete', alt: 'Complete anyway' },
    );
    if (choice === 'alt') toggleSliceCollapsed(slice.id, true, 'complete');
    if (choice !== 'ok') return;

    _pushUndo();
    let to = target;
    if (!to) {
        to = createSlice(slice.name ? `Carried over from ${slice.name}` : 'Carried over');
        _state.slices.splice(index + 1, 0, to);
    }
    moveCardsToSlice(unfinished, slice, to);
    slice.collapsed = true;
    slice.closedReason = 'complete';
    _peekedSlices.delete(slice.id);
    _logEvent?.(`Marked slice${quoted(slice.name)} complete and moved ${cards} to${quoted(to.name) || ' a new slice'}`, [slice.id, to.id]);
    keepSliceInPlace(slice.id, () => _renderAndSave());
};

export const createExpandButton = (item, { readOnly = false } = {}) => {
    const btn = el('button', 'btn-expand', { title: 'Expand card', ariaLabel: 'Expand card', html: '⤢' });
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (_openExpandModal) _openExpandModal(item, { readOnly });
    });
    return btn;
};

// Points field that only accepts numbers. Shared by the card menu and the expanded card;
// onChange runs after the item is updated.
export const createPointsInput = (item, onChange, className = 'points-input') => {
    const input = el('input', className);
    input.type = 'text';
    input.inputMode = 'decimal';
    input.placeholder = '–';
    input.value = item.points != null ? item.points : '';
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
        // Enter means done: leaving the box fires change, which saves the points
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); return; }
        // Allow navigation, delete, backspace, tab, decimal point
        if (['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        if (e.key === '.' && !e.target.value.includes('.')) return;
        if (e.key >= '0' && e.key <= '9') return;
        e.preventDefault();
    });
    input.addEventListener('change', (e) => {
        e.stopPropagation();
        const val = e.target.value.trim() === '' ? null : parseFloat(e.target.value);
        if (val !== null && isNaN(val)) { e.target.value = item.points ?? ''; return; }
        _pushUndo();
        item.points = val;
        _logEvent?.(`Changed card points${quoted(item.name)}`, [item.id]);
        onChange();
    });
    return input;
};

// Tag pills with remove buttons, plus an input that suggests tags already used in the map.
// Shared by the card menu and the expanded card; onChange runs after each add or remove.
export const createTagEditor = (item, onChange, { inputClass = 'tag-input' } = {}) => {
    const list = el('div', 'tags-list');
    const renderTagPills = () => {
        list.innerHTML = '';
        (item.tags || []).forEach(tag => {
            const pill = el('span', 'tag-pill');
            pill.appendChild(el('span', null, { text: tag }));
            const removeBtn = el('button', 'tag-remove', { text: '×', title: 'Remove tag' });
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                _pushUndo();
                item.tags = item.tags.filter(t => t !== tag);
                _logEvent?.(`Removed card tag${quoted(item.name)}`, [item.id]);
                renderTagPills();
                onChange();
            });
            pill.appendChild(removeBtn);
            list.appendChild(pill);
        });
    };
    renderTagPills();

    const inputWrapper = el('div', 'tag-input-wrapper');
    const input = el('input', inputClass);
    input.type = 'text';
    input.placeholder = 'Add tag...';
    // Tags are lowercased; stop mobile keyboards capitalising or correcting them as you type
    input.autocapitalize = 'off';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('enterkeyhint', 'done');
    input.addEventListener('click', (e) => e.stopPropagation());
    const autocomplete = el('div', 'tag-autocomplete');

    const addTag = (tagText) => {
        const trimmed = tagText.trim().toLowerCase();
        if (!trimmed) return;
        if (!item.tags) item.tags = [];
        if (item.tags.includes(trimmed)) return;
        _pushUndo();
        item.tags.push(trimmed);
        _logEvent?.(`Added card tag${quoted(item.name)}`, [item.id]);
        input.value = '';
        autocomplete.classList.remove('visible');
        renderTagPills();
        onChange();
    };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            addTag(input.value);
        }
    });

    // Some mobile keyboards have no Enter key, so also add the typed tag when leaving the field.
    // Wait a moment first: tapping a suggestion blurs the input before its click, and the click
    // clears the input, so the half-typed text isn't added as well.
    input.addEventListener('blur', () => {
        setTimeout(() => {
            if (document.activeElement === input) return;
            addTag(input.value);
            autocomplete.classList.remove('visible');
        }, 200);
    });

    input.addEventListener('input', () => {
        const val = input.value.trim().toLowerCase();
        autocomplete.innerHTML = '';
        if (!val) { autocomplete.classList.remove('visible'); return; }
        const existing = getAllTagsInMap().filter(t => t.includes(val) && !(item.tags || []).includes(t));
        if (existing.length === 0) { autocomplete.classList.remove('visible'); return; }
        existing.slice(0, 6).forEach(tag => {
            const suggestion = el('button', 'tag-suggestion', { text: tag });
            // Keep focus in the input so picking a suggestion doesn't count as leaving the field
            suggestion.addEventListener('mousedown', (e) => e.preventDefault());
            suggestion.addEventListener('click', (e) => {
                e.stopPropagation();
                addTag(tag);
            });
            autocomplete.appendChild(suggestion);
        });
        autocomplete.classList.add('visible');
    });

    inputWrapper.append(input, autocomplete);
    return { list, inputWrapper };
};

// Patch the card on the map for an item changed outside its own menu, e.g. from the expanded card
export const patchCardForItem = (item) => {
    const card = [..._dom.storyMap.querySelectorAll(`.story-card[data-story-id="${CSS.escape(item.id)}"]`)]
        .find(c => !c.closest('.partial-map-preview-col'));
    if (!card) return;
    patchCard(card, item);
    patchSliceMetrics(card.dataset.sliceId);
};

export const createOptionsMenu = (item, colors, onDelete, deleteMessage, onColorChange, onUrlChange, onStatusChange = null, onHide = null, onDeleteColumn = null) => {
    const container = el('div', 'card-options');

    const btn = el('button', 'btn-options', { text: '...', title: 'Options', ariaLabel: 'Options menu', ariaHasPopup: 'true', ariaExpanded: 'false' });
    const menu = el('div', 'options-menu');

    // Color option
    const colorOption = el('div', 'options-item options-color');
    colorOption.appendChild(el('span', null, { text: 'Color' }));
    const colorSwatches = el('div', 'color-swatches');
    colorSwatches.addEventListener('click', (e) => e.stopPropagation());
    const itemColor = item.color?.toLowerCase();
    Object.entries(colors).forEach(([name, hex]) => {
        const swatch = el('button', 'color-swatch', { title: name });
        swatch.style.backgroundColor = hex;
        swatch.dataset.color = hex.toLowerCase();
        if (itemColor === hex.toLowerCase()) swatch.classList.add('selected');
        swatch.addEventListener('click', (e) => {
            e.stopPropagation();
            _logEvent?.(`Changed card color${quoted(item.name)}`, [item.id]);
            onColorChange(hex);
            menu.classList.remove('visible');
        });
        colorSwatches.appendChild(swatch);
    });
    colorOption.appendChild(colorSwatches);
    menu.appendChild(colorOption);

    // Points option
    const pointsOption = el('div', 'options-item options-points');
    pointsOption.appendChild(el('span', null, { text: 'Points' }));
    const pointsInput = createPointsInput(item, () => {
        const card = container.closest('.step, .story-card');
        if (card) {
            patchCard(card, item);
            const sliceId = card.dataset.sliceId;
            if (sliceId) patchSliceMetrics(sliceId);
        }
        _saveToStorage();
    });
    pointsOption.appendChild(pointsInput);
    menu.appendChild(pointsOption);

    // Status option
    if (onStatusChange) {
        const statusOption = el('div', 'options-item options-status');
        statusOption.appendChild(el('span', null, { text: 'Status' }));
        const statusSwatches = el('div', 'status-swatches');
        statusSwatches.addEventListener('click', (e) => e.stopPropagation());

        const noneSwatch = el('button', 'status-swatch status-none', { title: 'None', text: '×' });
        noneSwatch.dataset.status = '';
        if (!item.status) noneSwatch.classList.add('selected');
        noneSwatch.addEventListener('click', (e) => {
            e.stopPropagation();
            _logEvent?.(`Changed card status${quoted(item.name)}`, [item.id]);
            onStatusChange(null);
            menu.classList.remove('visible');
        });
        statusSwatches.appendChild(noneSwatch);

        Object.entries(STATUS_OPTIONS).forEach(([key, { label, color }]) => {
            const swatch = el('button', 'status-swatch', { title: label });
            swatch.style.backgroundColor = color;
            swatch.dataset.status = key;
            if (item.status === key) swatch.classList.add('selected');
            swatch.addEventListener('click', (e) => {
                e.stopPropagation();
                _logEvent?.(`Changed card status${quoted(item.name)}`, [item.id]);
                onStatusChange(key);
                menu.classList.remove('visible');
            });
            statusSwatches.appendChild(swatch);
        });
        statusOption.appendChild(statusSwatches);
        menu.appendChild(statusOption);
    }

    // Tags option
    const tagsOption = el('div', 'options-item options-tags');
    tagsOption.appendChild(el('span', null, { text: 'Tags' }));
    tagsOption.addEventListener('click', (e) => e.stopPropagation());
    const tagEditor = createTagEditor(item, () => {
        const card = container.closest('.step, .story-card');
        if (card) patchCard(card, item);
        _saveToStorage();
    });
    tagsOption.append(tagEditor.list, tagEditor.inputWrapper);
    menu.appendChild(tagsOption);

    // URL option
    const urlOption = el('button', 'options-item', { text: item.url ? 'Edit URL...' : 'Add URL...' });
    urlOption.addEventListener('click', async (e) => {
        e.stopPropagation();
        const url = await showPrompt('Enter URL (https:// or http://):', item.url || '');
        if (url !== null) {
            if (url === '' || isValidUrl(url)) {
                _logEvent?.(`${url ? 'Added card URL' : 'Removed card URL'}${quoted(item.name)}`, [item.id]);
                onUrlChange(url);
            } else {
                await showAlert('Invalid URL. Please enter a valid http:// or https:// URL.');
            }
        }
        menu.classList.remove('visible');
    });
    menu.appendChild(urlOption);

    // Hide header option (for steps only)
    if (onHide) {
        const hideOption = el('button', 'options-item', { text: 'Hide Header' });
        hideOption.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.classList.remove('visible');
            onHide();
        });
        menu.appendChild(hideOption);
    }

    // Delete option (step cards have Delete Column instead)
    if (onDelete) {
        const deleteOption = el('button', 'options-item options-delete', { text: 'Delete' });
        deleteOption.addEventListener('click', async (e) => {
            e.stopPropagation();
            menu.classList.remove('visible');
            if (deleteMessage) {
                if (await showConfirm(deleteMessage)) onDelete();
            } else {
                onDelete();
            }
        });
        menu.appendChild(deleteOption);
    }

    // Delete column option (for step cards only)
    if (onDeleteColumn) {
        const deleteColumnOption = el('button', 'options-item options-delete-column', { text: 'Delete Column' });
        deleteColumnOption.addEventListener('click', async (e) => {
            e.stopPropagation();
            menu.classList.remove('visible');
            if (await showConfirm('Delete this column and all its stories?')) {
                onDeleteColumn();
            }
        });
        menu.appendChild(deleteColumnOption);
    }

    // Swatches are marked when the menu is built, but status, colour and points changes patch the
    // card without rebuilding it, so refresh the marks from the item each time the menu opens
    const syncSelection = () => {
        const color = item.color?.toLowerCase();
        menu.querySelectorAll('.color-swatch').forEach(s => s.classList.toggle('selected', s.dataset.color === color));
        menu.querySelectorAll('.status-swatch').forEach(s => s.classList.toggle('selected', s.dataset.status === (item.status || '')));
        pointsInput.value = item.points != null ? item.points : '';
    };

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.options-menu.visible').forEach(m => {
            if (m !== menu) {
                m.classList.remove('visible');
                m.closest('.step, .story-card')?.classList.remove('menu-open');
                m.parentElement?.querySelector('.btn-options')?.setAttribute('aria-expanded', 'false');
            }
        });
        const isOpen = menu.classList.toggle('visible');
        btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        const card = container.closest('.step, .story-card');
        if (isOpen) {
            syncSelection();
            card?.classList.add('menu-open');
            menu.classList.remove('flip-left');
            const rect = menu.getBoundingClientRect();
            if (rect.left < 0) menu.classList.add('flip-left');
        } else {
            card?.classList.remove('menu-open');
        }
    });

    container.append(btn, menu);
    return container;
};

export const createUrlIndicator = (url) => {
    if (!isValidUrl(url)) return null;
    const indicator = el('a', 'url-indicator', {
        href: url,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: url,
        html: '&#127760;' // Globe emoji
    });
    indicator.addEventListener('click', (e) => e.stopPropagation());
    return indicator;
};

export const createTextarea = (className, placeholder, value, onChange, onTextEdit) => {
    const isCardText = className === 'step-text' || className === 'story-text';
    const initialRows = isCardText ? (value && value.length > 20 ? 2 : 1) : 2;
    const textarea = el('textarea', className, { placeholder, value, rows: initialRows });

    // Push undo when user starts editing
    textarea.addEventListener('focus', () => _pushUndo());

    if (isCardText) {
        textarea.maxLength = TITLE_MAX_LENGTH;

        textarea.addEventListener('keydown', (e) => {
            if (textarea.value.length >= TITLE_MAX_LENGTH
                && !e.ctrlKey && !e.metaKey && !e.altKey
                && e.key.length === 1) {
                textarea.classList.add('limit-hit');
                setTimeout(() => textarea.classList.remove('limit-hit'), 400);
            }
        });

        const autoResize = () => {
            textarea.rows = 1;
            const lineHeight = parseInt(getComputedStyle(textarea).lineHeight) || 18;
            const neededRows = Math.ceil(textarea.scrollHeight / lineHeight);
            textarea.rows = Math.min(Math.max(neededRows, 1), 2);
        };

        textarea.addEventListener('input', (e) => {
            onChange(e.target.value);
            onTextEdit?.();
            autoResize();
            _saveToStorage();
        });

        requestAnimationFrame(autoResize);
    } else {
        textarea.addEventListener('input', (e) => {
            onChange(e.target.value);
            onTextEdit?.();
            _saveToStorage();
        });
    }

    return textarea;
};

const createColumnPlaceholder = (column) => {
    const placeholder = el('div', 'step-placeholder', { dataColumnId: column.id, title: 'Click to show step' });

    placeholder.addEventListener('click', () => {
        column.hidden = false;
        column.color = CARD_COLORS.green;
        _renderAndSave();
    });

    return placeholder;
};

export const createPhantomStep = (phantomIndex) => {
    const phantom = el('div', 'step-placeholder phantom-step', { title: 'Click to add a step' });
    phantom.addEventListener('click', () => {
        const col = _materializePhantomColumn(phantomIndex);
        if (col) {
            requestAnimationFrame(() => {
                const newStep = _dom.storyMap.querySelector(`[data-column-id="${col.id}"]`);
                if (newStep) {
                    _scrollElementIntoView(newStep);
                    newStep.querySelector('.step-text')?.focus();
                }
            });
        }
    });
    return phantom;
};

export const createPhantomStoryColumn = (phantomIndex, slice, insertIndex, rowTypeKey = null) => {
    const phantom = el('div', 'story-column phantom-column empty-backbone-column');
    phantom.addEventListener('click', () => {
        const col = _materializePhantomColumn(phantomIndex);
        if (col) {
            if (rowTypeKey) {
                _addStory(col.id, null, rowTypeKey);
            } else if (slice) {
                _addStory(col.id, slice.id);
            }
        }
    });
    return phantom;
};

// Update a card's visual properties in-place (color, status, points, tags, url)
export const patchCard = (card, item) => {
    card.style.backgroundColor = item.color || '';

    card.querySelector('.card-indicators')?.remove();
    card.appendChild(buildIndicators(item, card));

    if (_refilterCard) _refilterCard(card, item);
};

// Update slice metrics (progress bar, points) in-place
const patchSliceMetrics = (sliceId) => {
    if (!sliceId) return;
    const sliceLabel = _dom.storyMap.querySelector(`.slice-label-container[data-slice-id="${sliceId}"]`);
    if (!sliceLabel) return;
    const slice = _state.slices.find(s => s.id === sliceId);
    if (!slice) return;

    const oldMetrics = sliceLabel.querySelector('.slice-metrics');
    if (oldMetrics) oldMetrics.remove();

    const progress = getSliceProgress(slice);
    const points = getSlicePoints(slice);
    if (progress.total > 0 || points.hasAny) {
        const metricsContainer = el('div', 'slice-metrics');

        if (progress.total > 0) {
            const progressContainer = el('div', 'slice-progress', { title: `${progress.done} of ${progress.total} tasks done` });
            const progressTrack = el('div', 'slice-progress-track');
            const progressBar = el('div', 'slice-progress-bar');
            progressBar.style.width = `${progress.percent}%`;
            progressTrack.appendChild(progressBar);
            progressContainer.appendChild(progressTrack);
            progressContainer.appendChild(el('span', 'slice-progress-text', { text: `${progress.percent}%` }));
            metricsContainer.appendChild(progressContainer);
        }

        if (points.hasAny) {
            metricsContainer.appendChild(el('span', 'slice-points-text', {
                text: `${points.total} ${points.total === 1 ? 'pt' : 'pts'}`
            }));
        }

        const above = sliceLabel.querySelector('.slice-info') || sliceLabel.querySelector('.slice-label');
        if (above) above.after(metricsContainer);
        else sliceLabel.appendChild(metricsContainer);
    }
};

const buildIndicators = (item, card) => {
    const wrap = el('div', 'card-indicators');
    const urlIndicator = createUrlIndicator(item.url);
    if (urlIndicator) wrap.appendChild(urlIndicator);
    if (item.tags?.length > 0) wrap.appendChild(buildCardTags(item.tags, card));
    if (item.status && STATUS_OPTIONS[item.status]) {
        const dot = el('div', 'status-indicator', { title: STATUS_OPTIONS[item.status].label });
        dot.style.backgroundColor = STATUS_OPTIONS[item.status].color;
        wrap.appendChild(dot);
    }
    if (item.points != null && item.points > 0) {
        wrap.appendChild(el('span', 'points-badge', { text: String(item.points), title: `${item.points} points` }));
    }
    return wrap;
};

const buildCardTags = (tags, card) => {
    const tagsRow = el('div', 'card-tags-row');
    const maxVisible = tags.length <= 2 ? 2 : 1;
    tags.slice(0, maxVisible).forEach(tag => {
        tagsRow.appendChild(el('span', 'card-tag-badge', { text: tag }));
    });
    if (tags.length > maxVisible) {
        const overflowCount = tags.length - maxVisible;
        const overflow = el('span', 'card-tag-overflow', { text: `+${overflowCount}` });

        // Popover showing all tags on hover
        const popover = el('div', 'card-tags-popover');
        tags.forEach(tag => {
            popover.appendChild(el('span', 'card-tags-popover-pill', { text: tag }));
        });
        overflow.appendChild(popover);

        // Click toggles the tags popover
        overflow.addEventListener('click', (e) => {
            e.stopPropagation();
            popover.style.display = popover.style.display === 'flex' ? 'none' : 'flex';
        });
        tagsRow.appendChild(overflow);
    } else {
        // When all tags are visible, check if any are truncated and add popover
        requestAnimationFrame(() => {
            const badges = tagsRow.querySelectorAll('.card-tag-badge');
            if (![...badges].some(b => b.scrollWidth > b.clientWidth)) return;
            const anchor = el('span', 'card-tag-overflow');
            anchor.style.padding = '0';
            anchor.style.background = 'none';
            const popover = el('div', 'card-tags-popover');
            tags.forEach(tag => {
                popover.appendChild(el('span', 'card-tags-popover-pill', { text: tag }));
            });
            anchor.appendChild(popover);
            anchor.addEventListener('click', (e) => {
                e.stopPropagation();
                popover.style.display = popover.style.display === 'flex' ? 'none' : 'flex';
            });
            tagsRow.appendChild(anchor);
            // Make badges also act as click triggers
            badges.forEach(b => {
                b.style.cursor = 'pointer';
                b.addEventListener('click', (e) => {
                    e.stopPropagation();
                    popover.style.display = popover.style.display === 'flex' ? 'none' : 'flex';
                });
            });
        });
    }
    return tagsRow;
};

// =============================================================================
// Partial Map Reference Blocks (collapsed view)
// =============================================================================

export const createPartialMapRef = (refColumn, partialMap) => {
    const ref = el('div', 'step partial-map-ref', { dataColumnId: refColumn.id });

    const badge = el('span', 'partial-map-ref-badge', { text: 'Partial' });
    ref.appendChild(badge);

    const icon = el('span', 'partial-map-ref-icon');
    icon.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none"><rect x="3" y="3" width="7" height="7" rx="1" fill="#fef08a" stroke="#d4aa00" stroke-width="1"/><rect x="14" y="3" width="7" height="7" rx="1" fill="#fecdd3" stroke="#e88a9a" stroke-width="1"/><rect x="3" y="14" width="7" height="7" rx="1" fill="#a5f3fc" stroke="#67c5d6" stroke-width="1"/><rect x="14" y="14" width="7" height="7" rx="1" fill="#14b8a6" stroke="#0d9488" stroke-width="1"/></svg>';
    ref.appendChild(icon);

    const name = el('span', 'partial-map-ref-name', { text: partialMap.name });
    ref.appendChild(name);

    const cols = partialMap.columns;
    const stepCount = cols.length;
    const meta = el('span', 'partial-map-ref-meta', {
        text: `${stepCount} step${stepCount !== 1 ? 's' : ''}`
    });
    ref.appendChild(meta);

    if (cols.length > 0) {
        const range = el('span', 'partial-map-ref-range', {
            text: `${cols[0].name || '...'} → ${cols[cols.length - 1].name || '...'}`
        });
        ref.appendChild(range);
    }

    return ref;
};

export const createPartialMapRefCell = (refColumn) => {
    return el('div', 'story-column partial-map-ref-cell', {
        dataColumnId: refColumn.id
    });
};

export const createPreviewStoryColumn = (pmCol, stories, sliceId, rowTypeKey = null) => {
    const columnEl = el('div', 'story-column partial-map-preview-col', {
        dataColumnId: pmCol.id,
        dataSliceId: sliceId
    });

    (stories || []).forEach(story => {
        const cardAttrs = {
            dataStoryId: story.id,
            dataColumnId: pmCol.id,
        };
        if (rowTypeKey) {
            cardAttrs['data-row-type'] = rowTypeKey;
        } else if (sliceId) {
            cardAttrs.dataSliceId = sliceId;
        }
        const card = el('div', 'story-card', cardAttrs);
        if (story.color) card.style.backgroundColor = story.color;
        if (story.body) card.classList.add('has-body');

        const nameSpan = el('span', 'story-text-preview', { text: story.name || '' });
        card.appendChild(nameSpan);

        if (story.body) {
            card.appendChild(createExpandButton(story, { readOnly: true }));
        }

        card.appendChild(buildIndicators(story, card));

        columnEl.appendChild(card);
    });

    return columnEl;
};

export const createColumnCard = (column) => {
    if (column.hidden) {
        return createColumnPlaceholder(column);
    }

    // Partial blank columns: show as a clickable placeholder in steps row,
    // but the column is not hidden so backbone/slice rows still show add buttons
    if (column._partialBlank) {
        const placeholder = el('div', 'step-placeholder', { dataColumnId: column.id, title: 'Click to add a step' });
        placeholder.classList.add('partial-map-editing');
        placeholder.addEventListener('click', () => {
            delete column._partialBlank;
            _renderAndSave();
            requestAnimationFrame(() => {
                const step = _dom.storyMap.querySelector(`.step[data-column-id="${column.id}"]`);
                if (step) step.querySelector('.step-text')?.focus();
            });
        });
        return placeholder;
    }

    const card = el('div', 'step', { dataColumnId: column.id });
    if (column.color) card.style.backgroundColor = column.color;

    const dragHandle = el('div', 'step-drag-handle', { html: '↔', title: 'Drag to move entire column' });
    card.appendChild(dragHandle);

    const textarea = createTextarea('step-text', 'Step...', column.name,
        (val) => column.name = val,
        () => _logTextEdit?.('step name', column.id));

    const optionsMenu = createOptionsMenu(
        column,
        CARD_COLORS,
        null, // onDelete - steps are removed with Delete Column
        null,
        (color) => {
            _pushUndo();
            column.color = color;
            patchCard(card, column);
            _saveToStorage();
        },
        (url) => {
            _pushUndo();
            column.url = url || null;
            patchCard(card, column);
            _saveToStorage();
        },
        (status) => {
            _pushUndo();
            column.status = status;
            patchCard(card, column);
            _saveToStorage();
        },
        null, // onHide - not used for step cards
        () => _deleteColumn(column.id)
    );

    card.append(textarea, optionsMenu, buildIndicators(column, card));

    // Column selection on background click
    card.addEventListener('mousedown', (e) => {
        if (e.shiftKey && !e.target.closest('textarea, button, a, .options-menu')) e.preventDefault();
    });
    card.addEventListener('click', (e) => {
        if (e.target.closest('textarea, button, a, .options-menu')) return;
        if (_handleColumnSelection) _handleColumnSelection(column.id, e.shiftKey, { type: 'step' });
    });

    return card;
};

export const createStoryCard = (story, columnId, sliceId, isBackboneRow = false, rowType = null, rowTypeKey = null) => {
    const attrs = {
        dataStoryId: story.id,
        dataColumnId: columnId,
    };
    if (rowTypeKey) {
        attrs['data-row-type'] = rowTypeKey;
    } else {
        attrs.dataSliceId = sliceId;
    }
    const card = el('div', 'story-card', attrs);
    if (story.color) card.style.backgroundColor = story.color;
    if (story.body) card.classList.add('has-body');

    let placeholderText = 'Task or Detail...';
    if (rowType === 'Users') {
        placeholderText = 'e.g. admin, customer, client';
    } else if (rowType === 'Activities') {
        placeholderText = 'Activity...';
    } else if (isBackboneRow) {
        placeholderText = 'Step...';
    }
    const textarea = createTextarea('story-text', placeholderText, story.name,
        (val) => story.name = val,
        () => _logTextEdit?.('card title', story.id));

    const onDelete = () => _deleteStory(columnId, sliceId, story.id, rowTypeKey);
    const deleteMessage = isBackboneRow
        ? `Delete "${story.name || 'this card'}"?`
        : `Delete "${story.name || 'this task'}"?`;

    const optionsMenu = createOptionsMenu(
        story,
        CARD_COLORS,
        onDelete,
        deleteMessage,
        (color) => {
            _pushUndo();
            story.color = color;
            patchCard(card, story);
            _saveToStorage();
        },
        (url) => {
            _pushUndo();
            story.url = url || null;
            patchCard(card, story);
            _saveToStorage();
        },
        (status) => {
            _pushUndo();
            story.status = status;
            patchCard(card, story);
            if (sliceId) patchSliceMetrics(sliceId);
            _saveToStorage();
        },
        null, // onHide - not used
        isBackboneRow ? () => _deleteColumn(columnId) : null
    );

    card.append(textarea, createExpandButton(story), optionsMenu, buildIndicators(story, card));

    // Column selection on story card background click
    card.addEventListener('mousedown', (e) => {
        if (e.shiftKey && !e.target.closest('textarea, button, a, .options-menu')) e.preventDefault();
    });
    card.addEventListener('click', (e) => {
        if (e.target.closest('textarea, button, a, .options-menu')) return;
        if (_handleColumnSelection) _handleColumnSelection(columnId, e.shiftKey, { type: 'story', storyId: story.id, sliceId, rowType: rowTypeKey });
    });

    return card;
};

export const createStoryColumn = (col, slice, rowType = null) => {
    const attrs = { dataColumnId: col.id };
    if (rowType) {
        attrs['data-row-type'] = rowType;
    } else {
        attrs.dataSliceId = slice.id;
    }
    const columnEl = el('div', 'story-column', attrs);

    const isBackboneRow = !!rowType;
    let cards;
    if (rowType === 'users') {
        cards = _state.users[col.id] || [];
    } else if (rowType === 'activities') {
        cards = _state.activities[col.id] || [];
    } else {
        if (!slice.stories[col.id]) slice.stories[col.id] = [];
        cards = slice.stories[col.id];
    }

    cards.forEach(story => {
        columnEl.appendChild(createStoryCard(story, col.id, slice?.id || null, isBackboneRow, rowType === 'users' ? 'Users' : rowType === 'activities' ? 'Activities' : null, rowType));
    });

    // For backbone rows with no cards, make column clickable to add a card
    if (isBackboneRow && cards.length === 0) {
        columnEl.classList.add('empty-backbone-column');
        columnEl.addEventListener('click', (e) => {
            if (e.target === columnEl) {
                _addStory(col.id, null, rowType);
            }
        });
    }

    const hasCards = cards.length > 0;
    if ((!isBackboneRow || hasCards) && rowType !== 'activities' && (!col.hidden || hasCards)) {
        let btnText = '+';
        if (hasCards && rowType === 'users') btnText = '+ user';
        const addBtn = el('button', 'btn-add-story', { text: btnText });
        addBtn.addEventListener('click', () => _addStory(col.id, slice?.id || null, rowType));
        columnEl.appendChild(addBtn);
    }

    return columnEl;
};

export const createEmptyBackboneRow = (rowType) => {
    const rowTypeKey = rowType.toLowerCase(); // 'users' or 'activities'
    const containerClass = rowType === 'Users' ? 'users-row empty-backbone-row' :
                           rowType === 'Activities' ? 'activities-row empty-backbone-row' :
                           'backbone-row empty-backbone-row';
    const container = el('div', containerClass);

    const labelContainer = el('div', 'row-label-container');
    const label = el('span', 'row-type-label', { text: rowType });
    labelContainer.appendChild(label);
    container.appendChild(labelContainer);

    const storiesArea = el('div', 'slice-stories-area');
    const storiesRow = el('div', 'stories-row');

    const editingColIdsBR = _getEditingPartialColIds();
    const expandedIdsBR = partialMapEditState.expandedIds;
    const hasAnyExpandedBR = expandedIdsBR.size > 0 && !partialMapEditState.activeId;

    _state.columns.forEach(col => {
        if (col._editingHidden) return;
        if (col.partialMapId) {
            if (hasAnyExpandedBR && expandedIdsBR.has(col.partialMapId)) {
                const pm = _state.partialMaps.find(p => p.id === col.partialMapId);
                if (pm) {
                    const pmCardMap = rowTypeKey === 'users' ? pm.users : pm.activities;
                    pm.columns.forEach(pmCol => {
                        const cards = (pmCardMap || {})[pmCol.id] || [];
                        if (cards.length > 0) {
                            const colEl = createPreviewStoryColumn(pmCol, cards, null, rowTypeKey);
                            colEl.classList.add('partial-map-preview-col');
                            colEl.setAttribute('data-row-type', rowTypeKey);
                            if (rowTypeKey === 'users') {
                                const addBtn = el('button', 'btn-add-story', { text: '+ user' });
                                addBtn.disabled = true;
                                colEl.appendChild(addBtn);
                            }
                            storiesRow.appendChild(colEl);
                        } else {
                            const emptyPreview = el('div', 'story-column partial-map-preview-col empty-backbone-column', {
                                dataColumnId: pmCol.id
                            });
                            storiesRow.appendChild(emptyPreview);
                        }
                    });
                } else {
                    storiesRow.appendChild(createPartialMapRefCell(col));
                }
            } else {
                storiesRow.appendChild(createPartialMapRefCell(col));
            }
            return;
        }
        const columnEl = el('div', 'story-column empty-backbone-column', {
            dataColumnId: col.id,
            'data-row-type': rowTypeKey
        });
        if (editingColIdsBR?.has(col.id)) columnEl.classList.add('partial-map-editing-col');
        columnEl.addEventListener('click', () => {
            _addStory(col.id, null, rowTypeKey);
        });
        storiesRow.appendChild(columnEl);
    });

    for (let i = 0; i < PHANTOM_BUFFER; i++) {
        const phantom = createPhantomStoryColumn(i, null, null, rowTypeKey);
        storiesRow.appendChild(phantom);
    }

    storiesArea.appendChild(storiesRow);
    container.appendChild(storiesArea);

    return container;
};

export const createBackboneRow = (rowType, cardMap) => {
    const rowTypeKey = rowType.toLowerCase(); // 'users' or 'activities'
    const containerClass = rowType === 'Users' ? 'users-row' :
                           rowType === 'Activities' ? 'activities-row' :
                           'backbone-row';
    const container = el('div', containerClass);

    const labelContainer = el('div', 'row-label-container');
    const label = el('span', 'row-type-label', { text: rowType });
    labelContainer.appendChild(label);
    container.appendChild(labelContainer);

    const storiesArea = el('div', 'slice-stories-area');
    const storiesRow = el('div', 'stories-row');

    const editingColIdsBK = _getEditingPartialColIds();
    const expandedIdsBK = partialMapEditState.expandedIds;
    const hasAnyExpandedBK = expandedIdsBK.size > 0 && !partialMapEditState.activeId;

    _state.columns.forEach(col => {
        if (col._editingHidden) return;
        if (col.partialMapId) {
            if (hasAnyExpandedBK && expandedIdsBK.has(col.partialMapId)) {
                const pm = _state.partialMaps.find(p => p.id === col.partialMapId);
                if (pm) {
                    const pmCardMap = rowTypeKey === 'users' ? pm.users : pm.activities;
                    pm.columns.forEach(pmCol => {
                        const cards = (pmCardMap || {})[pmCol.id] || [];
                        if (cards.length > 0) {
                            const colEl = createPreviewStoryColumn(pmCol, cards, null, rowTypeKey);
                            colEl.classList.add('partial-map-preview-col');
                            colEl.setAttribute('data-row-type', rowTypeKey);
                            if (rowTypeKey === 'users') {
                                const addBtn = el('button', 'btn-add-story', { text: '+ user' });
                                addBtn.disabled = true;
                                colEl.appendChild(addBtn);
                            }
                            storiesRow.appendChild(colEl);
                        } else {
                            const emptyPreview = el('div', 'story-column partial-map-preview-col empty-backbone-column', {
                                dataColumnId: pmCol.id
                            });
                            storiesRow.appendChild(emptyPreview);
                        }
                    });
                } else {
                    storiesRow.appendChild(createPartialMapRefCell(col));
                }
            } else {
                storiesRow.appendChild(createPartialMapRefCell(col));
            }
            return;
        }
        const colEl = createStoryColumn(col, null, rowTypeKey);
        if (editingColIdsBK?.has(col.id)) colEl.classList.add('partial-map-editing-col');
        storiesRow.appendChild(colEl);
    });

    for (let i = 0; i < PHANTOM_BUFFER; i++) {
        storiesRow.appendChild(createPhantomStoryColumn(i, null, null, rowTypeKey));
    }

    storiesArea.appendChild(storiesRow);
    container.appendChild(storiesArea);

    return container;
};

// A card counts towards progress if it's a default (yellow) task card, or if it has a status.
// The status rule covers maps that give their tasks another colour; notes and questions rarely have one.
const countsTowardsProgress = (card) =>
    !card.color || card.color.toLowerCase() === DEFAULT_CARD_COLORS.story || !!card.status;

// Calculate progress for a slice (% of tasks marked done)
const getSliceProgress = (slice) => {
    let total = 0;
    let done = 0;
    cardsInSlice(slice).forEach(story => {
        if (countsTowardsProgress(story)) {
            total++;
            if (story.status === 'done') done++;
        }
    });
    return { total, done, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
};

const getSlicePoints = (slice) => {
    let total = 0, hasAny = false;
    Object.values(slice.stories || {}).forEach(stories => {
        stories.forEach(story => {
            if (story.points != null && story.points > 0) {
                total += Number(story.points);
                hasAny = true;
            }
        });
    });
    return { total, hasAny };
};

// The slice name in the gutter. Clicking it opens the details panel to rename it and set its
// goal and target date.
const createSliceName = (slice) => {
    const name = el('button', 'slice-label', { type: 'button' });
    setSliceNameText(name, slice.name);
    name.addEventListener('click', (e) => {
        e.stopPropagation();
        if (_isMapEditable()) openSliceDetails(slice, name);
    });
    return name;
};

// Slices someone is peeking into: a closed slice shown open in this browser only, never saved
const _peekedSlices = new Set();

// Partials a peek expanded, so it can show cards that sit in them, by slice. Hiding the cards
// collapses them again, unless another peek still needs them. Like the peek, this is never saved.
const _peekExpandedPartials = new Map();

const togglePeek = (sliceId) => {
    const slice = _state.slices.find(s => s.id === sliceId);
    if (!slice) return;
    let partialsChanged = false;
    if (_peekedSlices.has(sliceId)) {
        _peekedSlices.delete(sliceId);
        const expanded = _peekExpandedPartials.get(sliceId) || [];
        _peekExpandedPartials.delete(sliceId);
        const stillNeeded = new Set([..._peekExpandedPartials.values()].flat());
        expanded.filter(id => !stillNeeded.has(id)).forEach(id => {
            partialMapEditState.expandedIds.delete(id);
            partialsChanged = true;
        });
    } else {
        _peekedSlices.add(sliceId);
        // Expand collapsed partials holding cards of this slice, unless a partial is being edited
        if (!partialMapEditState.activeId) {
            const toExpand = [...new Set(sliceCardLists(slice).filter(l => l.pm && l.cards.length).map(l => l.pm.id))]
                .filter(id => !partialMapEditState.expandedIds.has(id));
            toExpand.forEach(id => partialMapEditState.expandedIds.add(id));
            if (toExpand.length) {
                _peekExpandedPartials.set(sliceId, toExpand);
                partialsChanged = true;
            }
        }
    }
    // Expanding or collapsing a partial changes every row, so the whole map renders
    keepSliceInPlace(sliceId, () => {
        if (partialsChanged || !rerenderSlice(sliceId)) _renderAndSave();
    });
};

// The cell under a collapsed partial in a slice that has cards inside it. It says how many, and
// showing them brings the partial's steps back in this browser, so the cards sit in their own
// columns. Hide cards, in the header above the partial's steps, folds it away again.
const createPartialSliceCell = (col, slice) => {
    const cell = createPartialMapRefCell(col);
    const pm = _state.partialMaps.find(p => p.id === col.partialMapId);
    const total = (pm?.columns || []).reduce((n, pmCol) => n + (pm.stories[slice.id]?.[pmCol.id]?.length || 0), 0);
    if (!total || partialMapEditState.activeId) return cell;

    const toggle = el('button', 'partial-cards-toggle', {
        type: 'button',
        title: `Show the steps of ${pm.name || 'this partial'} and the cards under them`,
    });
    toggle.append(
        el('span', null, { text: `Show ${total} ${total === 1 ? 'card' : 'cards'}` }),
        el('span', 'partial-cards-chevron', {
            ariaHidden: 'true',
            html: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
        }),
    );
    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        partialMapEditState.expandedIds.add(pm.id);
        keepSliceInPlace(slice.id, () => _renderAndSave());
    });
    cell.classList.add('partial-slice-cell');
    cell.appendChild(toggle);
    return cell;
};

// Every card in a slice, including those in partial map columns
const countSliceCards = (slice) => cardsInSlice(slice).length;

// The banner of a complete or closed slice. Clicking it shows or hides the cards for this
// browser only, so the slice stays closed for everyone else.
const createClosedBannerRow = (slice, peeking) => {
    const row = el('div', 'stories-row slice-completed-row');
    const expandedIds = partialMapEditState.expandedIds;
    const hasAnyExpanded = expandedIds.size > 0 && !partialMapEditState.activeId;
    _state.columns.forEach(col => {
        if (col._editingHidden) return;
        const pm = col.partialMapId && hasAnyExpanded && expandedIds.has(col.partialMapId)
            ? _state.partialMaps.find(p => p.id === col.partialMapId) : null;
        const count = pm ? pm.columns.length : 1;
        for (let i = 0; i < count; i++) row.appendChild(el('div', 'story-column collapsed-column-placeholder'));
    });
    for (let i = 0; i < PHANTOM_BUFFER; i++) {
        row.appendChild(el('div', 'story-column collapsed-column-placeholder'));
    }

    const isClosed = slice.closedReason === 'closed';
    const banner = el('div', `slice-completed-banner${isClosed ? ' slice-closed-banner' : ''}${peeking ? ' peeking' : ''}`);
    const statusText = isClosed ? 'Closed' : 'Complete';
    const cards = countSliceCards(slice);
    const toggle = el('button', 'slice-peek-toggle', {
        type: 'button',
        ariaExpanded: String(peeking),
        title: peeking
            ? 'Hide the cards. Reopen the slice from its ☰ menu to edit them.'
            : 'Show the cards, read-only. The slice stays closed for everyone else.',
    });
    // The name truncates on one line; the status after it always shows
    if (slice.name) toggle.appendChild(el('span', 'slice-completed-name', { text: slice.name }));
    toggle.appendChild(el('span', 'slice-completed-text', { text: slice.name ? ` - ${statusText}` : statusText }));
    toggle.appendChild(el('span', 'slice-card-count', { text: `${cards} ${cards === 1 ? 'card' : 'cards'}` }));
    // A complete slice with cards that aren't done notes how many, in amber, beside the count
    const unfinished = isClosed ? 0 : unfinishedSliceCards(slice).length;
    if (unfinished > 0) toggle.appendChild(el('span', 'slice-not-done', { text: `${unfinished} not done` }));
    if (peeking) {
        const readOnly = el('span', 'slice-peek-readonly');
        readOnly.append(
            el('span', 'slice-peek-lock', {
                ariaHidden: 'true',
                html: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
            }),
            document.createTextNode('Read-only'),
        );
        toggle.appendChild(readOnly);
    }
    // Says what a click does, so the banner reads as a control
    const action = el('span', 'slice-peek-action');
    action.append(
        el('span', 'slice-peek-action-text', { text: peeking ? 'Hide cards' : 'Show cards' }),
        el('span', 'slice-peek-chevron', {
            ariaHidden: 'true',
            html: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
        }),
    );
    toggle.appendChild(action);
    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePeek(slice.id);
    });
    banner.appendChild(toggle);
    const bannerInfo = createSliceInfo(slice, 'slice-info-banner');
    if (bannerInfo) banner.appendChild(bannerInfo);
    row.appendChild(banner);
    return row;
};

// The cards of a closed slice while someone peeks: read-only, like a partial map preview, so
// they can't be edited, moved or deleted until the slice is reopened
const createPeekRow = (slice) => {
    const row = el('div', `stories-row slice-peek-row${slice.closedReason === 'closed' ? ' slice-peek-closed' : ''}`);
    const peekColumn = (col, stories) => {
        const colEl = createPreviewStoryColumn(col, stories, slice.id);
        colEl.classList.add('slice-peek-col');
        return colEl;
    };
    const expandedIds = partialMapEditState.expandedIds;
    const hasAnyExpanded = expandedIds.size > 0 && !partialMapEditState.activeId;
    _state.columns.forEach(col => {
        if (col._editingHidden) return;
        if (!col.partialMapId) {
            row.appendChild(peekColumn(col, slice.stories[col.id]));
            return;
        }
        const pm = hasAnyExpanded && expandedIds.has(col.partialMapId)
            ? _state.partialMaps.find(p => p.id === col.partialMapId) : null;
        if (pm) pm.columns.forEach(pmCol => row.appendChild(peekColumn(pmCol, pm.stories[slice.id]?.[pmCol.id])));
        else row.appendChild(createPartialSliceCell(col, slice));
    });
    for (let i = 0; i < PHANTOM_BUFFER; i++) {
        row.appendChild(el('div', 'story-column collapsed-column-placeholder'));
    }
    return row;
};

export const createSliceContainer = (slice, index) => {
    const peeking = slice.collapsed && _peekedSlices.has(slice.id);
    let containerClass = 'slice-container';
    if (slice.collapsed) containerClass += peeking ? ' slice-peeking' : ' slice-collapsed';
    const container = el('div', containerClass, { dataSliceId: slice.id });

    const labelContainer = el('div', 'slice-label-container', { dataSliceId: slice.id });

    if (slice.collapsed) {
        const controlsRow = el('div', 'slice-controls-row');
        const dragHandle = el('div', 'slice-drag-handle', { html: '↕', title: 'Drag to reorder' });
        controlsRow.appendChild(dragHandle);
        // The ⓘ sits between the controls, or at the end of the banner where the gutter is narrow
        const info = createSliceInfo(slice, 'slice-info-gutter');
        if (info) controlsRow.appendChild(info);
        controlsRow.appendChild(createSliceMenu(slice));
        labelContainer.appendChild(controlsRow);
        container.appendChild(labelContainer);

        const storiesArea = el('div', 'slice-stories-area');
        storiesArea.appendChild(createClosedBannerRow(slice, peeking));
        if (peeking) storiesArea.appendChild(createPeekRow(slice));
        container.appendChild(storiesArea);

        return container;
    }

    labelContainer.appendChild(createSliceName(slice));
    const info = createSliceInfo(slice);
    if (info) labelContainer.appendChild(info);

    const progress = getSliceProgress(slice);
    const points = getSlicePoints(slice);
    if (progress.total > 0 || points.hasAny) {
        const metricsContainer = el('div', 'slice-metrics');

        if (progress.total > 0) {
            const progressContainer = el('div', 'slice-progress', {
                title: `${progress.done} of ${progress.total} tasks done`
            });
            const progressTrack = el('div', 'slice-progress-track');
            const progressBar = el('div', 'slice-progress-bar');
            progressBar.style.width = `${progress.percent}%`;
            progressTrack.appendChild(progressBar);
            progressContainer.appendChild(progressTrack);
            const progressText = el('span', 'slice-progress-text', {
                text: `${progress.percent}%`
            });
            progressContainer.appendChild(progressText);
            metricsContainer.appendChild(progressContainer);
        }

        if (points.hasAny) {
            const pointsText = el('span', 'slice-points-text', {
                text: `${points.total} ${points.total === 1 ? 'pt' : 'pts'}`
            });
            metricsContainer.appendChild(pointsText);
        }

        labelContainer.appendChild(metricsContainer);
    }

    const controlsRow = el('div', 'slice-controls-row');
    const dragHandle = el('div', 'slice-drag-handle', { html: '↕', title: 'Drag to reorder' });
    controlsRow.appendChild(dragHandle);

    controlsRow.appendChild(createSliceMenu(slice));
    labelContainer.appendChild(controlsRow);

    const addSliceBtn = el('button', 'btn-add-slice', { text: '+ Slice' });
    addSliceBtn.addEventListener('click', () => _addSlice(index + 1));
    labelContainer.appendChild(addSliceBtn);

    container.appendChild(labelContainer);

    const storiesArea = el('div', 'slice-stories-area');
    const storiesRow = el('div', 'stories-row');

    const editingColIds = _getEditingPartialColIds();
    const expandedIdsSC = partialMapEditState.expandedIds;
    const hasAnyExpandedSC = expandedIdsSC.size > 0 && !partialMapEditState.activeId;

    _state.columns.forEach(col => {
        if (col._editingHidden) return;
        if (col.partialMapId) {
            if (hasAnyExpandedSC && expandedIdsSC.has(col.partialMapId)) {
                const pm = _state.partialMaps.find(p => p.id === col.partialMapId);
                if (pm) {
                    pm.columns.forEach(pmCol => {
                        const stories = pm.stories[slice.id]?.[pmCol.id] || [];
                        storiesRow.appendChild(createPreviewStoryColumn(pmCol, stories, slice.id));
                    });
                } else {
                    storiesRow.appendChild(createPartialMapRefCell(col));
                }
            } else {
                storiesRow.appendChild(createPartialSliceCell(col, slice));
            }
        } else {
            const colEl = createStoryColumn(col, slice, null);
            if (editingColIds?.has(col.id)) colEl.classList.add('partial-map-editing-col');
            storiesRow.appendChild(colEl);
        }
    });

    for (let i = 0; i < PHANTOM_BUFFER; i++) {
        storiesRow.appendChild(createPhantomStoryColumn(i, slice));
    }
    storiesArea.appendChild(storiesRow);

    container.appendChild(storiesArea);
    return container;
};

// =============================================================================
// Legend
// =============================================================================

export const renderLegend = () => {
    if (!_dom.legendEntries) return;
    _dom.legendEntries.innerHTML = '';
    const editable = _isMapEditable();

    _state.legend.forEach(entry => {
        const row = el('div', 'legend-entry', { 'data-legend-id': entry.id });

        const swatch = el('button', 'legend-swatch', { title: 'Change color' });
        swatch.style.backgroundColor = entry.color;
        if (editable) {
            swatch.addEventListener('click', (e) => {
                e.stopPropagation();
                showLegendColorPicker(entry, swatch);
            });
        }
        row.appendChild(swatch);

        const input = el('input', 'legend-label');
        input.type = 'text';
        input.value = entry.label;
        input.placeholder = 'Label...';
        input.readOnly = !editable;
        if (editable) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    input.blur();
                }
            });
            input.addEventListener('blur', () => {
                if (entry.label !== input.value) {
                    _pushUndo();
                    entry.label = input.value;
                    _logEvent?.('Updated legend label');
                    _saveToStorage();
                }
            });
        }
        row.appendChild(input);
        // Filled in by renderMapStats(); sits before the remove button so × keeps the right edge
        row.appendChild(el('span', 'legend-count'));

        if (editable) {
            const removeBtn = el('button', 'legend-remove', { text: '\u00d7', title: 'Remove' });
            removeBtn.addEventListener('click', () => {
                _pushUndo();
                _state.legend = _state.legend.filter(e => e.id !== entry.id);
                _logEvent?.('Removed legend entry');
                _renderAndSave();
            });
            row.appendChild(removeBtn);
        }

        _dom.legendEntries.appendChild(row);
    });

    const maxReached = _state.legend.length >= Object.keys(CARD_COLORS).length;
    _dom.legendAddBtn.style.display = editable && !maxReached ? '' : 'none';
    _dom.legendPanel.classList.toggle('has-entries', _state.legend.length > 0);
    // The panel always has map stats, so only disable the tab when there's no map to describe
    _dom.legendToggle.disabled = _state.columns.length === 0;
    if (_dom.legendToggle.disabled && _dom.legendToggle.classList.contains('active')) {
        _dom.legendPanel.classList.remove('open');
        _dom.legendToggle.classList.remove('active');
        _dom.controlsRight?.classList.remove('panel-open');
    }
    renderMapStats();
};

// One progress row per slice in the Overview tab: name above a full-width bar so long names fit.
// Maps with many slices show the first few until expanded.
const SLICE_ROWS_COLLAPSED = 5;
let _showAllSliceRows = false;

const renderSliceProgress = () => {
    const statusColors = [
        ...Object.entries(STATUS_OPTIONS).map(([key, { color }]) => [key, color]),
        ['none', 'var(--color-border-strong)'],
    ];
    const list = el('div', 'map-stats-slices');
    const visible = _showAllSliceRows ? _state.slices : _state.slices.slice(0, SLICE_ROWS_COLLAPSED);

    visible.forEach((slice, i) => {
        const name = (slice.name || '').replace(/\s*\n\s*/g, ' ').trim() || `Slice ${i + 1}`;
        const { total, done } = getSliceProgress(slice);
        const row = el('div', 'map-stats-slice');
        row.appendChild(el('span', 'map-stats-slice-name', { text: name }));

        const closed = slice.collapsed ? (slice.closedReason === 'closed' ? 'Closed' : 'Complete') : null;
        if (closed) row.classList.add('map-stats-slice-closed');
        if (total === 0) {
            row.appendChild(el('span', `map-stats-slice-count${closed ? ` map-stats-${closed.toLowerCase()}` : ''}`, { text: closed ? `${closed === 'Complete' ? '✓ ' : ''}${closed}` : 'No tasks' }));
            row.title = name;
        } else {
            // A complete or closed slice keeps its bar, faded, with its state in place of the count
            row.appendChild(el('span', `map-stats-slice-count${closed ? ` map-stats-${closed.toLowerCase()}` : ''}`, {
                text: closed ? `${closed === 'Complete' ? '✓ ' : ''}${closed}` : `${done}/${total}`,
            }));
            const counts = {};
            cardsInSlice(slice).filter(countsTowardsProgress).forEach(card => {
                const key = card.status && STATUS_OPTIONS[card.status] ? card.status : 'none';
                counts[key] = (counts[key] || 0) + 1;
            });
            const bar = el('div', 'map-stats-bar');
            statusColors.forEach(([key, color]) => {
                if (!counts[key]) return;
                const part = el('i');
                part.style.width = `${(counts[key] / total) * 100}%`;
                part.style.background = color;
                bar.appendChild(part);
            });
            row.appendChild(bar);
            row.title = `${name}: ${closed ? `${closed.toLowerCase()}, ` : ''}${done} of ${total} tasks done`;
        }
        list.appendChild(row);
    });

    if (_state.slices.length > SLICE_ROWS_COLLAPSED) {
        const toggle = el('button', 'map-stats-more', {
            text: _showAllSliceRows ? 'Show fewer' : `Show all ${_state.slices.length} slices`,
        });
        toggle.type = 'button';
        toggle.addEventListener('click', () => {
            _showAllSliceRows = !_showAllSliceRows;
            renderMapStats();
        });
        list.appendChild(toggle);
    }
    return list;
};

// Map stats at the top of the Legend panel: counts, overall progress, and cards per legend category.
// Progress uses the same rule as each slice's bar (task cards only), summed across slices.
export const renderMapStats = () => {
    const container = document.getElementById('mapStats');
    if (!container) return;

    // Cards, steps, users and activities inside partials count too, whether a partial is collapsed or not
    const flatten = (byColumn) => Object.values(byColumn || {}).flat();
    const partials = placedPartials();
    const sliceCards = _state.slices.flatMap(cardsInSlice);
    const counts = [
        [sliceCards.length, 'card', 'cards'],
        [_state.columns.filter(c => !c.hidden && !c.partialMapId).length + partials.reduce((n, pm) => n + pm.columns.length, 0), 'step', 'steps'],
        [_state.slices.length, 'slice', 'slices'],
        [flatten(_state.users).length + partials.reduce((n, pm) => n + flatten(pm.users).length, 0), 'user', 'users'],
        [flatten(_state.activities).length + partials.reduce((n, pm) => n + flatten(pm.activities).length, 0), 'activity', 'activities'],
        [(_state.partialMaps || []).length, 'partial', 'partials'],
    ];

    const tasks = _state.slices.map(getSliceProgress);
    const totalTasks = tasks.reduce((n, p) => n + p.total, 0);
    const doneTasks = tasks.reduce((n, p) => n + p.done, 0);

    const statusCounts = { none: 0 };
    Object.keys(STATUS_OPTIONS).forEach(key => { statusCounts[key] = 0; });
    sliceCards.filter(countsTowardsProgress).forEach(card => {
        const key = card.status && statusCounts[card.status] !== undefined ? card.status : 'none';
        statusCounts[key]++;
    });
    const segments = [
        ...Object.entries(STATUS_OPTIONS).map(([key, { label, color }]) => ({ n: statusCounts[key], label: label.toLowerCase(), color })),
        { n: statusCounts.none, label: 'no status', color: 'var(--color-border-strong)' },
    ].filter(s => s.n > 0);

    container.innerHTML = '';
    const tiles = el('div', 'map-stats-tiles');
    counts.forEach(([n, one, many]) => {
        const tile = el('div', 'map-stats-tile');
        tile.append(el('b', null, { text: String(n) }), el('span', null, { text: n === 1 ? one : many }));
        tiles.appendChild(tile);
    });
    container.appendChild(tiles);

    if (totalTasks > 0) {
        container.appendChild(el('div', 'map-stats-label', {
            text: 'Progress',
            title: `${doneTasks} of ${totalTasks} tasks done`,
        }));
        container.appendChild(renderSliceProgress());
        const key = el('div', 'map-stats-key');
        segments.forEach(s => {
            const item = el('span', null, { text: `${s.n} ${s.label}` });
            item.style.setProperty('--c', s.color);
            key.appendChild(item);
        });
        container.appendChild(key);
    } else if (sliceCards.length > 0) {
        // Cards exist but none count, so explain rather than hiding progress
        container.appendChild(el('div', 'map-stats-label', { text: 'Progress' }));
        container.appendChild(el('div', 'map-stats-empty', {
            text: 'Nothing to track yet. Progress counts yellow task cards and any card with a status.',
        }));
    }

    if (_state.legend.length > 0) container.appendChild(el('div', 'map-stats-label', { text: 'Legend' }));

    // Cards per legend category, matched by colour
    const byColor = {};
    sliceCards.forEach(card => {
        const color = (card.color || DEFAULT_CARD_COLORS.story).toLowerCase();
        byColor[color] = (byColor[color] || 0) + 1;
    });
    _state.legend.forEach(entry => {
        const countEl = _dom.legendEntries?.querySelector(`.legend-entry[data-legend-id="${entry.id}"] .legend-count`);
        if (!countEl) return;
        const n = byColor[(entry.color || '').toLowerCase()] || 0;
        countEl.textContent = n;
        countEl.title = `${n} ${n === 1 ? 'card' : 'cards'} in this category`;
    });
};

const showLegendColorPicker = (entry, anchorEl) => {
    document.querySelector('.legend-color-picker')?.remove();

    const picker = el('div', 'legend-color-picker');
    const swatches = el('div', 'color-swatches');
    Object.entries(CARD_COLORS).forEach(([name, hex]) => {
        const swatch = el('button', 'color-swatch', { title: name });
        swatch.style.backgroundColor = hex;
        if (entry.color?.toLowerCase() === hex.toLowerCase()) swatch.classList.add('selected');
        swatch.addEventListener('click', (e) => {
            e.stopPropagation();
            _pushUndo();
            entry.color = hex;
            _logEvent?.('Changed legend color');
            _renderAndSave();
            picker.remove();
        });
        swatches.appendChild(swatch);
    });
    picker.appendChild(swatches);

    _dom.legendBody.appendChild(picker);

    const close = (e) => {
        if (!picker.contains(e.target) && e.target !== anchorEl) {
            picker.remove();
            document.removeEventListener('click', close);
        }
    };
    setTimeout(() => document.addEventListener('click', close), 0);
};

// =============================================================================
// Partials Panel
// =============================================================================

export const renderPartialsList = () => {
    if (!_dom.partialsList) return;
    _dom.partialsList.innerHTML = '';
    const editable = _isMapEditable();

    if (_state.partialMaps.length === 0) {
        const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
        if (isTouchDevice) {
            // Touch users can't create partials (requires marquee select),
            // so hide the tab entirely when none exist
            _dom.partialsToggle.style.display = 'none';
        } else {
            const empty = el('div', 'partials-empty', { text: 'Select columns to create a partial' });
            _dom.partialsList.appendChild(empty);
            _dom.partialsToggle.disabled = !editable;
        }
        if (_dom.partialsToggle.classList.contains('active')) {
            _dom.partialsPanel.classList.remove('open');
            _dom.partialsToggle.classList.remove('active');
            _dom.controlsRight?.classList.remove('panel-open');
        }
        return;
    }

    _dom.partialsToggle.style.display = '';
    _dom.partialsToggle.disabled = false;

    // Expand All / Collapse All button
    const isEditing = !!partialMapEditState.activeId;
    const allExpanded = _state.partialMaps.every(pm => partialMapEditState.expandedIds.has(pm.id));
    const expandBtn = el('button', 'partials-expand-btn', {
        text: allExpanded ? 'Collapse All' : 'Expand All'
    });
    if (isEditing) {
        expandBtn.disabled = true;
        expandBtn.title = 'Exit edit mode first';
    }
    expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isEditing) return;
        if (allExpanded) {
            partialMapEditState.expandedIds.clear();
        } else {
            _state.partialMaps.forEach(pm => partialMapEditState.expandedIds.add(pm.id));
        }
        _renderAndSave();
    });
    _dom.partialsList.appendChild(expandBtn);

    _state.partialMaps.forEach(pm => {
        const entry = el('div', 'partials-entry');
        const isThisExpanded = partialMapEditState.expandedIds.has(pm.id);

        const info = el('div', 'partials-entry-info');
        const isEditingThis = editable && partialMapEditState.activeId === pm.id;
        let nameEl;
        if (isEditingThis) {
            nameEl = el('input', 'partials-entry-name partials-entry-name-input');
            nameEl.type = 'text';
            nameEl.value = pm.name || '';
            nameEl.placeholder = 'Untitled';
            nameEl.addEventListener('input', () => { pm.name = nameEl.value; });
            nameEl.addEventListener('change', () => { _saveToStorage(); });
            nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameEl.blur(); });
        } else {
            nameEl = el('span', 'partials-entry-name', { text: pm.name || 'Untitled' });
        }
        const stepCount = pm.columns.length;
        const userCount = Object.values(pm.users || {}).reduce((sum, cards) => sum + cards.length, 0);
        const activityCount = Object.values(pm.activities || {}).reduce((sum, cards) => sum + cards.length, 0);
        const storyCount = Object.values(pm.stories || {}).reduce((sum, colStories) =>
            sum + Object.values(colStories).reduce((s, cards) => s + cards.length, 0), 0);
        const parts = [`${stepCount} step${stepCount !== 1 ? 's' : ''}`];
        if (userCount > 0) parts.push(`${userCount} user${userCount !== 1 ? 's' : ''}`);
        if (activityCount > 0) parts.push(`${activityCount} activit${activityCount !== 1 ? 'ies' : 'y'}`);
        if (storyCount > 0) parts.push(`${storyCount} stor${storyCount !== 1 ? 'ies' : 'y'}`);
        const meta = el('span', 'partials-entry-meta', {
            text: parts.join(', ')
        });
        info.append(nameEl, meta);
        entry.appendChild(info);

        if (editable) {
            const actions = el('div', 'partials-entry-actions');

            if (isEditingThis) {
                const doneBtn = el('button', 'partials-entry-btn editing', { text: 'Done' });
                doneBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (_stopEditingPartial) _stopEditingPartial();
                });
                actions.appendChild(doneBtn);
            } else {
                // Expand / Collapse toggle
                if (!isEditing) {
                    const toggleBtn = el('button', `partials-entry-btn${isThisExpanded ? ' expanded' : ''}`, {
                        text: isThisExpanded ? 'Collapse' : 'Expand'
                    });
                    toggleBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (isThisExpanded) {
                            partialMapEditState.expandedIds.delete(pm.id);
                        } else {
                            partialMapEditState.expandedIds.add(pm.id);
                        }
                        _renderAndSave();
                    });
                    actions.appendChild(toggleBtn);
                }

                const editBtn = el('button', 'partials-entry-btn', { text: 'Edit' });
                editBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (_startEditingPartial) _startEditingPartial(pm.id);
                });
                actions.appendChild(editBtn);

                const deleteBtn = el('button', 'partials-entry-btn delete', { text: 'Delete' });
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    // Close any other open popovers
                    document.querySelectorAll('.partial-delete-popover').forEach(p => p.remove());
                    const popover = el('div', 'partial-delete-popover');
                    const deletePmBtn = el('button', 'partial-delete-popover-btn danger');
                    deletePmBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg><span><strong>Delete Partial</strong><span class="partial-delete-popover-desc">Remove the partial and its reference columns</span></span>';
                    const restoreBtn = el('button', 'partial-delete-popover-btn restore');
                    restoreBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 105.64-11.36L1 10"/></svg><span><strong>Restore Columns</strong><span class="partial-delete-popover-desc">Put the original columns back into the map</span></span>';
                    deletePmBtn.addEventListener('click', (e2) => {
                        e2.stopPropagation();
                        popover.remove();
                        if (_deletePartialMap) _deletePartialMap(pm.id);
                    });
                    restoreBtn.addEventListener('click', (e2) => {
                        e2.stopPropagation();
                        popover.remove();
                        if (_restorePartialMap) _restorePartialMap(pm.id);
                    });
                    popover.append(deletePmBtn, restoreBtn);
                    // Append to body with fixed positioning to avoid overflow clipping
                    document.body.appendChild(popover);
                    const rect = deleteBtn.getBoundingClientRect();
                    popover.style.top = (rect.bottom + 4) + 'px';
                    popover.style.right = (window.innerWidth - rect.right) + 'px';
                    // Close on click outside or Escape
                    const close = (ev) => {
                        if (!popover.contains(ev.target)) {
                            popover.remove();
                            document.removeEventListener('click', close, true);
                            document.removeEventListener('keydown', closeKey, true);
                        }
                    };
                    const closeKey = (ev) => {
                        if (ev.key === 'Escape') {
                            popover.remove();
                            document.removeEventListener('click', close, true);
                            document.removeEventListener('keydown', closeKey, true);
                        }
                    };
                    setTimeout(() => {
                        document.addEventListener('click', close, true);
                        document.addEventListener('keydown', closeKey, true);
                    }, 0);
                });
                actions.appendChild(deleteBtn);
            }

            entry.appendChild(actions);
        }

        _dom.partialsList.appendChild(entry);
    });
};
