// Storymaps.io — AGPL-3.0 — see LICENCE for details
// State management, undo/redo, and factory functions

import { generateId, CARD_COLORS } from '/src/core/constants.js';
import { showConfirm } from '/src/core/modals.js';

export const state = {
    mapId: null,
    name: '',
    columns: [],
    users: {},
    activities: {},
    slices: [],
    legend: [],
    notes: '',
    partialMaps: [],
    mapLoaded: false
};

// Ephemeral state for partial map editing (not serialized, not synced)
export const partialMapEditState = { activeId: null, expandedIds: new Set(), editingColIds: new Set() };

// Ephemeral selection state (not serialized, not synced, not in undo)
export const selection = { columnIds: [], anchorId: null, clickedCards: [], columnHighlight: false };
export const clearSelection = () => { selection.columnIds = []; selection.anchorId = null; selection.clickedCards = []; selection.columnHighlight = false; };

// Undo/Redo stack (in-memory, lost on refresh)
const undoStack = [];
const redoStack = [];
const MAX_UNDO = 50;

// Callbacks set via init()
let _dom = null;
let _serialize = null;
let _deserialize = null;
let _renderAndSave = null;
let _logEvent = null;

export const init = ({ serialize, deserialize, renderAndSave, logEvent }) => {
    _dom = {
        boardName: document.getElementById('boardName'),
        storyMap: document.getElementById('storyMap'),
        undoBtn: document.getElementById('undoBtn'),
        redoBtn: document.getElementById('redoBtn'),
    };
    _serialize = serialize;
    _deserialize = deserialize;
    _renderAndSave = renderAndSave;
    _logEvent = logEvent;
};

const cloneCardMap = (cardMap) => Object.fromEntries(
    Object.entries(cardMap).map(([colId, cards]) => [colId, cards.map(c => ({ ...c }))])
);

// Deep-clone state with IDs preserved (for undo/redo)
const snapshotState = () => JSON.stringify({
    name: state.name,
    columns: state.columns.map(c => { const { _editingHidden, _partialBlank, ...rest } = c; return rest; }),
    users: cloneCardMap(state.users),
    activities: cloneCardMap(state.activities),
    slices: state.slices.map(s => ({
        ...s,
        stories: cloneCardMap(s.stories)
    })),
    legend: state.legend,
    notes: state.notes,
    partialMaps: state.partialMaps.map(pm => ({
        ...pm,
        columns: pm.columns.map(c => ({ ...c, tags: [...(c.tags || [])] })),
        users: cloneCardMap(pm.users || {}),
        activities: cloneCardMap(pm.activities || {}),
        stories: Object.fromEntries(
            Object.entries(pm.stories).map(([sliceId, colStories]) => [
                sliceId,
                Object.fromEntries(
                    Object.entries(colStories).map(([colId, stories]) => [colId, stories.map(st => ({ ...st, tags: [...(st.tags || [])] }))])
                )
            ])
        )
    })),
});

const restoreSnapshot = (json) => {
    const snap = JSON.parse(json);
    state.name = snap.name;
    state.columns = snap.columns;
    state.users = snap.users;
    state.activities = snap.activities;
    state.slices = snap.slices;
    state.legend = snap.legend;
    state.notes = snap.notes;
    state.partialMaps = snap.partialMaps || [];
};

export const pushUndo = () => {
    undoStack.push(snapshotState());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0; // Clear redo on new action
    updateUndoRedoButtons();
};

export const undo = () => {
    if (undoStack.length === 0) return;
    const beforeSerialized = _serialize();
    redoStack.push(snapshotState());
    restoreSnapshot(undoStack.pop());
    partialMapEditState.activeId = null;
    partialMapEditState.expandedIds.clear();
    partialMapEditState.editingColIds.clear();
    const changes = findChangedPositions(beforeSerialized, _serialize());
    _dom.boardName.value = state.name;
    _renderAndSave();
    highlightChangedElements(changes);
    _logEvent?.('Undo');
    updateUndoRedoButtons();
};

export const redo = () => {
    if (redoStack.length === 0) return;
    const beforeSerialized = _serialize();
    undoStack.push(snapshotState());
    restoreSnapshot(redoStack.pop());
    partialMapEditState.activeId = null;
    partialMapEditState.expandedIds.clear();
    partialMapEditState.editingColIds.clear();
    const changes = findChangedPositions(beforeSerialized, _serialize());
    _dom.boardName.value = state.name;
    _renderAndSave();
    highlightChangedElements(changes);
    _logEvent?.('Redo');
    updateUndoRedoButtons();
};

export const updateUndoRedoButtons = () => {
    if (_dom?.undoBtn) _dom.undoBtn.disabled = undoStack.length === 0;
    if (_dom?.redoBtn) _dom.redoBtn.disabled = redoStack.length === 0;
};

// Compare two serialized states and return positions of changed elements
const findChangedPositions = (before, after) => {
    const changes = { columns: [], stories: [], sliceNames: [], backboneCards: [] };

    // Compare columns (steps)
    const maxCols = Math.max(before.steps?.length || 0, after.steps?.length || 0);
    for (let i = 0; i < maxCols; i++) {
        const bCol = before.steps?.[i];
        const aCol = after.steps?.[i];
        if (JSON.stringify(bCol) !== JSON.stringify(aCol)) {
            changes.columns.push(i);
        }
    }

    // Compare users/activities backbone rows
    for (const rowKey of ['users', 'activities']) {
        const bRow = before[rowKey] || [];
        const aRow = after[rowKey] || [];
        for (let ci = 0; ci < maxCols; ci++) {
            const bCards = bRow[ci] || [];
            const aCards = aRow[ci] || [];
            const maxCards = Math.max(bCards.length, aCards.length);
            for (let cdi = 0; cdi < maxCards; cdi++) {
                if (JSON.stringify(bCards[cdi]) !== JSON.stringify(aCards[cdi])) {
                    changes.backboneCards.push({ row: rowKey, col: ci, card: cdi });
                }
            }
        }
    }

    // Compare slices and stories
    const maxSlices = Math.max(before.slices?.length || 0, after.slices?.length || 0);
    for (let si = 0; si < maxSlices; si++) {
        const bSlice = before.slices?.[si];
        const aSlice = after.slices?.[si];

        // Check slice name
        if ((bSlice?.name || '') !== (aSlice?.name || '')) {
            changes.sliceNames.push(si);
        }

        // Compare stories in each column
        const bStories = bSlice?.stories || [];
        const aStories = aSlice?.stories || [];
        for (let ci = 0; ci < maxCols; ci++) {
            const bColStories = bStories[ci] || [];
            const aColStories = aStories[ci] || [];
            const maxStories = Math.max(bColStories.length, aColStories.length);

            for (let sti = 0; sti < maxStories; sti++) {
                if (JSON.stringify(bColStories[sti]) !== JSON.stringify(aColStories[sti])) {
                    changes.stories.push({ slice: si, col: ci, story: sti });
                }
            }
        }
    }

    return changes;
};

// Apply highlight to changed elements after render (skip selected cards)
const highlightChangedElements = (changes) => {
    const selectedColIds = new Set(selection.columnIds);

    // Highlight changed columns (steps row)
    changes.columns.forEach(colIdx => {
        const col = state.columns[colIdx];
        if (col && !selectedColIds.has(col.id)) {
            const step = _dom.storyMap.querySelector(`.step[data-column-id="${col.id}"]`);
            if (step) step.classList.add('undo-highlight');
        }
    });

    // Highlight changed backbone cards (users/activities)
    changes.backboneCards?.forEach(({ row, col: colIdx, card: cardIdx }) => {
        const col = state.columns[colIdx];
        if (!col || selectedColIds.has(col.id)) return;

        const rowClass = row === 'users' ? '.users-row' : '.activities-row';
        const rowEl = _dom.storyMap.querySelector(rowClass);
        if (!rowEl) return;

        const column = rowEl.querySelector(`.story-column[data-column-id="${col.id}"]`);
        if (!column) return;

        const card = column.querySelectorAll('.story-card')[cardIdx];
        if (card) card.classList.add('undo-highlight');
    });

    // Highlight changed stories
    changes.stories.forEach(({ slice: sliceIdx, col: colIdx, story: storyIdx }) => {
        const slice = state.slices[sliceIdx];
        const col = state.columns[colIdx];
        if (!slice || !col || selectedColIds.has(col.id)) return;

        const sliceContainer = _dom.storyMap.querySelector(`[data-slice-id="${slice.id}"]`);
        if (!sliceContainer) return;

        const column = sliceContainer.querySelector(`.story-column[data-column-id="${col.id}"]`);
        if (!column) return;

        const card = column.querySelectorAll('.story-card')[storyIdx];
        if (card) card.classList.add('undo-highlight');
    });

    // Highlight changed slice names (only for release slices with labels)
    changes.sliceNames.forEach(sliceIdx => {
        const slice = state.slices[sliceIdx];
        if (!slice) return;

        const label = _dom.storyMap.querySelector(`.slice-label-container[data-slice-id="${slice.id}"]`);
        if (label) label.classList.add('undo-highlight');
    });

    // Remove highlight class after animation completes
    setTimeout(() => {
        _dom.storyMap.querySelectorAll('.undo-highlight').forEach(el => {
            el.classList.remove('undo-highlight');
        });
    }, 1600);
};

export const initState = () => {
    const column = createColumn('New Step', CARD_COLORS.green, null, false);
    state.name = '';
    state.columns = [column];
    state.partialMaps = [];
    partialMapEditState.activeId = null;
    partialMapEditState.expandedIds.clear();
    partialMapEditState.editingColIds.clear();
    state.users = { [column.id]: [createStory('User Type', '#fca5a5')] };
    state.activities = { [column.id]: [createStory('New Activity', '#93c5fd')] };
    state.legend = [
        { id: generateId(), color: CARD_COLORS.yellow, label: 'Tasks' },
        { id: generateId(), color: CARD_COLORS.cyan, label: 'Notes' },
        { id: generateId(), color: CARD_COLORS.lime, label: 'Questions' },
        { id: generateId(), color: CARD_COLORS.rose, label: 'Edge cases' },
    ];
    state.notes = '';
    state.slices = [
        { id: generateId(), name: '', collapsed: false, stories: { [column.id]: [createStory('New Task or Detail', '#fef08a')] } }
    ];
};

export const hasContent = () => {
    if (state.name) return true;
    if (state.columns.some(s => s.name)) return true;
    if (state.partialMaps.length > 0) return true;
    for (const cards of Object.values(state.users)) {
        if (cards.length > 0) return true;
    }
    for (const cards of Object.values(state.activities)) {
        if (cards.length > 0) return true;
    }
    if (state.slices.some(s => s.name)) return true;
    for (const slice of state.slices) {
        for (const stories of Object.values(slice.stories)) {
            if (stories.length > 0) return true;
        }
    }
    return false;
};

export const confirmOverwrite = async () => {
    return !hasContent() || await showConfirm('This will replace your current story map. Continue?');
};

export const createColumn = (name = '', color = null, url = null, hidden = false, status = null, points = null, tags = [], body = '') => ({ id: generateId(), name, body, color, url, hidden, status, points, tags });
export const createRefColumn = (partialMapId, origin = true) => ({ id: generateId(), name: '', body: '', color: null, url: null, hidden: false, status: null, points: null, tags: [], partialMapId, partialMapOrigin: origin });
export const createStory = (name = '', color = null, url = null, hidden = false, status = null, points = null, tags = [], body = '') => ({ id: generateId(), name, body, color, url, hidden, status, points, tags });
export const createSlice = (name = '') => {
    const slice = { id: generateId(), name, collapsed: false, stories: {} };
    state.columns.forEach(s => slice.stories[s.id] = []);
    return slice;
};
