// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Partial map CRUD operations

import { dom } from '/src/ui/dom.js';
import { generateId, CARD_COLORS } from '/src/core/constants.js';
import { state, pushUndo, createColumn, createRefColumn, clearSelection, partialMapEditState } from '/src/core/state.js';
import { scrollElementIntoView } from '/src/ui/navigation.js';

let _deps = {};

export const init = (deps) => { _deps = deps; };

// Materialize phantom columns up to and including the given index (0-based).
// Columns before the target are created hidden (spacers); the target column is visible.
export const materializePhantomColumn = (phantomIndex = 0) => {
    pushUndo();
    let targetColumn = null;
    for (let i = 0; i <= phantomIndex; i++) {
        const hidden = i < phantomIndex;
        const column = createColumn('', CARD_COLORS.green, null, hidden);
        state.columns.push(column);
        state.users[column.id] = [];
        state.activities[column.id] = [];
        state.slices.forEach(slice => slice.stories[column.id] = []);
        if (!hidden) targetColumn = column;
    }
    _deps.renderAndSave();
    return targetColumn;
};

export const createPartialMap = (name, columnIds) => {
    const selectedCols = state.columns.filter(c => columnIds.includes(c.id));
    if (selectedCols.length === 0) return;

    pushUndo();

    const pmId = generateId();

    // Deep-copy columns into partial definition
    const pmColumns = selectedCols.map(c => ({
        ...c,
        id: c.id,
        tags: [...(c.tags || [])]
    }));

    // Move stories from slices into the partial
    const pmStories = {};
    state.slices.forEach(slice => {
        pmStories[slice.id] = {};
        selectedCols.forEach(col => {
            pmStories[slice.id][col.id] = (slice.stories[col.id] || []).map(s => ({
                ...s,
                tags: [...(s.tags || [])]
            }));
            delete slice.stories[col.id];
        });
    });

    // Move users/activities into the partial
    const pmUsers = {};
    const pmActivities = {};
    selectedCols.forEach(col => {
        pmUsers[col.id] = (state.users[col.id] || []).map(s => ({ ...s, tags: [...(s.tags || [])] }));
        pmActivities[col.id] = (state.activities[col.id] || []).map(s => ({ ...s, tags: [...(s.tags || [])] }));
        delete state.users[col.id];
        delete state.activities[col.id];
    });

    state.partialMaps.push({
        id: pmId,
        name,
        columns: pmColumns,
        users: pmUsers,
        activities: pmActivities,
        stories: pmStories
    });

    // Replace selected columns with a single reference column at the first selected position
    const firstIdx = state.columns.findIndex(c => c.id === selectedCols[0].id);
    const refCol = createRefColumn(pmId, true);

    state.columns = state.columns.filter(c => !columnIds.includes(c.id));
    state.columns.splice(firstIdx, 0, refCol);

    // Add empty story arrays for the ref column
    state.users[refCol.id] = [];
    state.activities[refCol.id] = [];
    state.slices.forEach(slice => {
        slice.stories[refCol.id] = [];
    });

    clearSelection();
    _deps.renderAndSave();

    _deps.switchPanelTab('partials');
};

const isColumnEmpty = (col) => {
    if (col.name && col.name.trim() !== '') return false;
    if ((state.users[col.id] || []).length > 0) return false;
    if ((state.activities[col.id] || []).length > 0) return false;
    return !state.slices.some(s => (s.stories[col.id] || []).length > 0);
};

export const ensurePartialBlankCol = () => {
    const pmId = partialMapEditState.activeId;
    if (!pmId) return;
    const refCol = state.columns.find(c => c.partialMapId === pmId && c._editingHidden);
    if (!refCol) return;
    const refIdx = state.columns.indexOf(refCol);

    // Find end of partial's editing range using tracked IDs
    let endIdx = refIdx + 1;
    while (endIdx < state.columns.length && partialMapEditState.editingColIds.has(state.columns[endIdx].id)) {
        endIdx++;
    }

    // Check if the last column in range is already an empty blank
    if (endIdx > refIdx + 1) {
        const lastCol = state.columns[endIdx - 1];
        if (lastCol._partialBlank && isColumnEmpty(lastCol)) return;
    }

    // Add a new blank column at endIdx
    const blankCol = createColumn('', null, null, false);
    blankCol._partialBlank = true;
    state.columns.splice(endIdx, 0, blankCol);
    state.users[blankCol.id] = [];
    state.activities[blankCol.id] = [];
    state.slices.forEach(slice => { slice.stories[blankCol.id] = []; });
    partialMapEditState.editingColIds.add(blankCol.id);
};

export const startEditingPartial = (partialMapId) => {
    const pm = state.partialMaps.find(p => p.id === partialMapId);
    if (!pm) return;

    partialMapEditState.expandedIds.clear();
    pushUndo();

    const refCol = state.columns.find(c => c.partialMapId === partialMapId && c.partialMapOrigin)
        || state.columns.find(c => c.partialMapId === partialMapId);
    if (!refCol) return;

    const refIdx = state.columns.indexOf(refCol);

    // Mark ref column as hidden during editing
    refCol._editingHidden = true;

    // Splice partial's columns into state.columns after the ref
    state.columns.splice(refIdx + 1, 0, ...pm.columns);

    // Inject partial's stories into slices
    state.slices.forEach(slice => {
        const pmSliceStories = pm.stories[slice.id] || {};
        pm.columns.forEach(col => {
            slice.stories[col.id] = pmSliceStories[col.id] || [];
        });
    });

    // Inject partial's users/activities into state
    pm.columns.forEach(col => {
        state.users[col.id] = (pm.users?.[col.id] || []);
        state.activities[col.id] = (pm.activities?.[col.id] || []);
    });

    partialMapEditState.activeId = partialMapId;
    partialMapEditState.editingColIds = new Set(pm.columns.map(c => c.id));

    // Add blank column at the right edge for adding new steps
    ensurePartialBlankCol();

    _deps.renderAndSave();

    requestAnimationFrame(() => {
        if (pm.columns.length > 0) {
            const firstCol = dom.storyMap.querySelector(`.step[data-column-id="${pm.columns[0].id}"]`);
            if (firstCol) scrollElementIntoView(firstCol);
        }
    });
};

export const stopEditingPartial = () => {
    const pmId = partialMapEditState.activeId;
    if (!pmId) return;

    const pm = state.partialMaps.find(p => p.id === pmId);
    if (!pm) return;

    pushUndo();

    // Find the hidden ref column
    const refCol = state.columns.find(c => c.partialMapId === pmId && c._editingHidden);

    // Gather editing columns in state.columns order using tracked IDs
    const allRangeColIds = new Set(partialMapEditState.editingColIds);
    const editedColumns = state.columns.filter(c => allRangeColIds.has(c.id));

    // Prune trailing empty columns (blank columns the user didn't fill)
    while (editedColumns.length > 0 && isColumnEmpty(editedColumns[editedColumns.length - 1])) {
        editedColumns.pop();
    }

    // Update partial columns from the kept edited columns
    pm.columns = editedColumns.map(c => {
        const { _partialBlank, ...rest } = c;
        return { ...rest, tags: [...(c.tags || [])] };
    });

    // Update partial stories from slices
    pm.stories = {};
    state.slices.forEach(slice => {
        pm.stories[slice.id] = {};
        pm.columns.forEach(col => {
            pm.stories[slice.id][col.id] = (slice.stories[col.id] || []).map(s => ({
                ...s,
                tags: [...(s.tags || [])]
            }));
        });
        // Clean up all range columns from slice stories
        for (const colId of allRangeColIds) {
            delete slice.stories[colId];
        }
    });

    // Update partial users/activities from state
    pm.users = {};
    pm.activities = {};
    pm.columns.forEach(col => {
        pm.users[col.id] = (state.users[col.id] || []).map(s => ({ ...s, tags: [...(s.tags || [])] }));
        pm.activities[col.id] = (state.activities[col.id] || []).map(s => ({ ...s, tags: [...(s.tags || [])] }));
    });
    // Clean up all range columns from state users/activities
    for (const colId of allRangeColIds) {
        delete state.users[colId];
        delete state.activities[colId];
    }

    // Remove all range columns from state.columns
    state.columns = state.columns.filter(c => !allRangeColIds.has(c.id));

    // Unhide the ref column
    if (refCol) delete refCol._editingHidden;

    partialMapEditState.activeId = null;
    partialMapEditState.editingColIds.clear();
    _deps.renderAndSave();
};

export const deletePartialMap = (partialMapId) => {
    pushUndo();

    // Remove all reference columns pointing to this partial
    state.columns = state.columns.filter(c => c.partialMapId !== partialMapId);

    // Clean up stories/users/activities for removed ref columns
    const colIds = new Set(state.columns.map(c => c.id));
    state.slices.forEach(slice => {
        for (const colId of Object.keys(slice.stories)) {
            if (!colIds.has(colId)) delete slice.stories[colId];
        }
    });
    for (const colId of Object.keys(state.users)) {
        if (!colIds.has(colId)) delete state.users[colId];
    }
    for (const colId of Object.keys(state.activities)) {
        if (!colIds.has(colId)) delete state.activities[colId];
    }

    state.partialMaps = state.partialMaps.filter(p => p.id !== partialMapId);

    if (partialMapEditState.activeId === partialMapId) {
        partialMapEditState.activeId = null;
    }

    // Ensure at least one column remains
    if (state.columns.length === 0) {
        const col = createColumn('New Step', CARD_COLORS.green, null, false);
        state.columns.push(col);
        state.users[col.id] = [];
        state.activities[col.id] = [];
        state.slices.forEach(slice => slice.stories[col.id] = []);
    }

    _deps.renderAndSave();
};

export const restorePartialMap = (partialMapId) => {
    const pm = state.partialMaps.find(p => p.id === partialMapId);
    if (!pm) return;

    pushUndo();

    // Find the first ref column for this partial (prefer origin)
    const refCol = state.columns.find(c => c.partialMapId === partialMapId && c.partialMapOrigin)
        || state.columns.find(c => c.partialMapId === partialMapId);
    const insertIdx = refCol ? state.columns.indexOf(refCol) : state.columns.length;

    // Count ref columns before the insert point (to adjust index after removal)
    const refsBefore = state.columns.filter((c, i) => c.partialMapId === partialMapId && i < insertIdx).length;

    // Remove ALL ref columns for this partial and clean up their data
    const refColIds = state.columns.filter(c => c.partialMapId === partialMapId).map(c => c.id);
    state.columns = state.columns.filter(c => c.partialMapId !== partialMapId);
    refColIds.forEach(colId => {
        delete state.users[colId];
        delete state.activities[colId];
    });
    state.slices.forEach(slice => {
        refColIds.forEach(colId => { delete slice.stories[colId]; });
    });

    const adjustedIdx = Math.min(insertIdx - refsBefore, state.columns.length);

    // Splice partial's columns back into state.columns
    state.columns.splice(adjustedIdx, 0, ...pm.columns);

    // Restore stories into slices
    state.slices.forEach(slice => {
        const pmSliceStories = pm.stories[slice.id] || {};
        pm.columns.forEach(col => {
            slice.stories[col.id] = pmSliceStories[col.id] || [];
        });
    });

    // Restore users/activities
    pm.columns.forEach(col => {
        state.users[col.id] = pm.users?.[col.id] || [];
        state.activities[col.id] = pm.activities?.[col.id] || [];
    });

    // Remove the partial definition
    state.partialMaps = state.partialMaps.filter(p => p.id !== partialMapId);

    if (partialMapEditState.activeId === partialMapId) {
        partialMapEditState.activeId = null;
    }

    _deps.renderAndSave();
};

export const replaceWithPartial = (partialMapId, columnIds) => {
    const selectedCols = state.columns.filter(c => columnIds.includes(c.id));
    if (selectedCols.length === 0) return;

    pushUndo();

    const firstIdx = state.columns.findIndex(c => c.id === selectedCols[0].id);

    // Delete selected columns and their data
    state.columns = state.columns.filter(c => !columnIds.includes(c.id));
    columnIds.forEach(colId => {
        delete state.users[colId];
        delete state.activities[colId];
    });
    state.slices.forEach(slice => {
        columnIds.forEach(colId => {
            delete slice.stories[colId];
        });
    });

    // Insert ref column at the first selected position
    const refCol = createRefColumn(partialMapId, false);
    state.columns.splice(firstIdx, 0, refCol);
    state.users[refCol.id] = [];
    state.activities[refCol.id] = [];
    state.slices.forEach(slice => {
        slice.stories[refCol.id] = [];
    });

    clearSelection();
    _deps.renderAndSave();
    _deps.switchPanelTab('partials');
};

export const insertPartialMapRef = (partialMapId, afterColumnIndex) => {
    pushUndo();
    const refCol = createRefColumn(partialMapId, false);
    state.columns.splice(afterColumnIndex + 1, 0, refCol);
    state.users[refCol.id] = [];
    state.activities[refCol.id] = [];
    state.slices.forEach(slice => {
        slice.stories[refCol.id] = [];
    });
    _deps.renderAndSave();
};
