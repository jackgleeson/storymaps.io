// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Yjs document management, CRDT helpers, sync

import { CARD_COLORS } from '/src/core/constants.js';

let _state = null;
let _notepad = null;
let _log = null;
let _dom = null;
let _isMapEditable = null;
let _render = null;
let _setPreserveToolbar = null;

const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

let provider = null;
let ydoc = null;
let ymap = null;
export let isSyncingFromRemote = false;
let _remoteRenderTimer = null;
let _hasNewRemoteEvents = false;
let lastSyncedHash = null;

const stateHash = () => JSON.stringify([
    _state.name,
    _state.columns,
    _state.users,
    _state.activities,
    _state.slices,
    _state.legend,
    _state.partialMaps,
    ydoc.getText('notes').toString(),
]);

// Yjs modules — lazy-loaded to avoid blocking the welcome screen
let Y = null;
let WebsocketProvider = null;
let _yjsLoadPromise = null;

export const loadYjs = () => {
    if (_yjsLoadPromise) return _yjsLoadPromise;
    _yjsLoadPromise = import('/vendor/yjs.bundle.js').then((mod) => {
        Y = mod;
        WebsocketProvider = mod.WebsocketProvider;
    });
    return _yjsLoadPromise;
};

// Sortable.js - Drag and Drop (lazy loaded)
let Sortable = null;
let sortableLoadPromise = null;
export const ensureSortable = () => {
    if (Sortable) return Promise.resolve(Sortable);
    if (sortableLoadPromise) return sortableLoadPromise;

    sortableLoadPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js';
        script.onload = () => {
            Sortable = window.Sortable;
            resolve(Sortable);
        };
        script.onerror = reject;
        document.head.appendChild(script);
    });
    return sortableLoadPromise;
};

export const getIsSafari = () => isSafari;

export const init = ({ state, notepad, log, isMapEditable, render, setPreserveToolbar }) => {
    _state = state;
    _notepad = notepad;
    _log = log;
    _dom = { boardName: document.getElementById('boardName') };
    _isMapEditable = isMapEditable;
    _render = render;
    _setPreserveToolbar = setPreserveToolbar;
};

export const getProvider = () => provider;
export const getYdoc = () => ydoc;
export const getYmap = () => ymap;

// =============================================================================
// Yjs Nested CRDT Helpers
// =============================================================================

// Field definitions for cards (columns and stories share the same fields)
const CARD_FIELDS = {
    name:   { default: '' },
    body:   { default: '' },
    color:  { default: null },
    url:    { default: null },
    hidden: { default: false },
    status: { default: null },
    points: { default: null },
    partialMapId: { default: null },
    partialMapOrigin: { default: false }
};

const createYCard = (obj) => {
    const yMap = new Y.Map();
    yMap.set('id', obj.id);
    for (const [field, { default: defaultVal }] of Object.entries(CARD_FIELDS)) {
        const value = obj[field];
        if (field === 'name' || (value && value !== defaultVal)) {
            yMap.set(field, value ?? defaultVal);
        }
    }
    if (obj.tags?.length) yMap.set('tags', JSON.stringify(obj.tags));
    return yMap;
};

const updateYCard = (yMap, obj) => {
    for (const [field, { default: defaultVal }] of Object.entries(CARD_FIELDS)) {
        const newValue = field === 'name' ? (obj[field] || '') : obj[field];
        const currentValue = yMap.get(field);
        if (currentValue !== newValue) {
            if (newValue && newValue !== defaultVal) {
                yMap.set(field, newValue);
            } else if (field === 'name') {
                yMap.set(field, '');
            } else {
                yMap.delete(field);
            }
        }
    }
    const tagsJson = obj.tags?.length ? JSON.stringify(obj.tags) : null;
    const currentTags = yMap.get('tags') || null;
    if (tagsJson !== currentTags) {
        if (tagsJson) yMap.set('tags', tagsJson);
        else yMap.delete('tags');
    }
};

const cardFromYjs = (data) => {
    let tags = [];
    if (data.tags) {
        try { tags = JSON.parse(data.tags); } catch { /* ignore */ }
    }
    return {
        id: data.id,
        name: data.name || '',
        body: data.body || '',
        color: data.color || null,
        url: data.url || null,
        hidden: data.hidden || false,
        status: data.status || null,
        points: data.points ?? null,
        tags,
        partialMapId: data.partialMapId || null,
        partialMapOrigin: data.partialMapOrigin || false
    };
};

const createYColumn = createYCard;
const createYStory = createYCard;
const updateYColumn = updateYCard;
const updateYStory = updateYCard;

const createYLegendEntry = (entry) => {
    const yMap = new Y.Map();
    yMap.set('id', entry.id);
    yMap.set('color', entry.color);
    yMap.set('label', entry.label || '');
    return yMap;
};

const updateYLegendEntry = (yMap, entry) => {
    if (yMap.get('color') !== entry.color) yMap.set('color', entry.color);
    if (yMap.get('label') !== (entry.label || '')) yMap.set('label', entry.label || '');
};

const createYSlice = (slice, columns) => {
    const ySlice = new Y.Map();
    ySlice.set('id', slice.id);
    ySlice.set('name', slice.name || '');
    if (slice.collapsed) ySlice.set('collapsed', true);
    if (slice.closedReason) ySlice.set('closedReason', slice.closedReason);

    const yStories = new Y.Map();
    columns.forEach(col => {
        const yStoryArray = new Y.Array();
        const stories = slice.stories[col.id] || [];
        stories.forEach(story => {
            yStoryArray.push([createYStory(story)]);
        });
        yStories.set(col.id, yStoryArray);
    });
    ySlice.set('stories', yStories);

    return ySlice;
};

// Create a Yjs map for a backbone row (users or activities)
const createYBackboneRow = (cardMap, columns) => {
    const yRow = new Y.Map();
    columns.forEach(col => {
        const yCardArray = new Y.Array();
        const cards = cardMap[col.id] || [];
        cards.forEach(card => {
            yCardArray.push([createYCard(card)]);
        });
        yRow.set(col.id, yCardArray);
    });
    return yRow;
};

// =============================================================================
// Sync
// =============================================================================

const readBackboneRowFromYjs = (yRow) => {
    const cardMap = {};
    if (!yRow) return cardMap;
    const rowData = typeof yRow.toJSON === 'function' ? yRow.toJSON() : yRow;
    if (typeof rowData === 'object' && rowData !== null) {
        for (const [colId, cards] of Object.entries(rowData)) {
            cardMap[colId] = Array.isArray(cards) ? cards.map(cardFromYjs) : [];
        }
    }
    return cardMap;
};

export const syncFromYjs = () => {
    if (!ymap) return;

    const name = ymap.get('name');
    if (name !== undefined) _state.name = name;

    const yColumns = ymap.get('columns');
    if (yColumns) {
        const columnsData = typeof yColumns.toJSON === 'function' ? yColumns.toJSON() : yColumns;
        if (Array.isArray(columnsData)) {
            _state.columns = columnsData.map(cardFromYjs);
        }
    }

    // Read users/activities from their own Yjs maps
    const yUsers = ymap.get('users');
    if (yUsers) {
        _state.users = readBackboneRowFromYjs(yUsers);
    }
    const yActivities = ymap.get('activities');
    if (yActivities) {
        _state.activities = readBackboneRowFromYjs(yActivities);
    }

    // Ensure all columns have entries
    _state.columns.forEach(col => {
        if (!_state.users[col.id]) _state.users[col.id] = [];
        if (!_state.activities[col.id]) _state.activities[col.id] = [];
    });

    const ySlices = ymap.get('slices');
    if (ySlices) {
        const slicesData = typeof ySlices.toJSON === 'function' ? ySlices.toJSON() : ySlices;
        if (Array.isArray(slicesData)) {
            // Check if old format (slices contain rowType) - migrate on the fly
            const hasOldFormat = slicesData.some(s => s.rowType === 'Users' || s.rowType === 'Activities');

            if (hasOldFormat) {
                // Migrate: extract Users/Activities into state.users/state.activities
                const releaseSlices = [];
                slicesData.forEach(sliceData => {
                    const storiesData = sliceData.stories || {};
                    if (sliceData.rowType === 'Users') {
                        _state.columns.forEach(col => {
                            const columnStories = storiesData[col.id];
                            _state.users[col.id] = Array.isArray(columnStories) ? columnStories.map(cardFromYjs) : [];
                        });
                    } else if (sliceData.rowType === 'Activities') {
                        _state.columns.forEach(col => {
                            const columnStories = storiesData[col.id];
                            _state.activities[col.id] = Array.isArray(columnStories) ? columnStories.map(cardFromYjs) : [];
                        });
                    } else {
                        releaseSlices.push(sliceData);
                    }
                });
                _state.slices = releaseSlices.map(sliceData => {
                    const slice = {
                        id: sliceData.id,
                        name: sliceData.name || '',
                        collapsed: sliceData.collapsed || false,
                        stories: {}
                    };
                    if (sliceData.closedReason) slice.closedReason = sliceData.closedReason;
                    const storiesData = sliceData.stories || {};
                    _state.columns.forEach(col => {
                        const columnStories = storiesData[col.id];
                        slice.stories[col.id] = Array.isArray(columnStories) ? columnStories.map(cardFromYjs) : [];
                    });
                    return slice;
                });
                // Trigger a write-back to convert the Yjs doc to v2 format
                requestAnimationFrame(() => {
                    if (ymap && !isSyncingFromRemote) syncToYjs();
                });
            } else {
                _state.slices = slicesData.map(sliceData => {
                    const slice = {
                        id: sliceData.id,
                        name: sliceData.name || '',
                        collapsed: sliceData.collapsed || false,
                        stories: {}
                    };
                    if (sliceData.closedReason) slice.closedReason = sliceData.closedReason;
                    const storiesData = sliceData.stories || {};
                    _state.columns.forEach(col => {
                        const columnStories = storiesData[col.id];
                        slice.stories[col.id] = Array.isArray(columnStories) ? columnStories.map(cardFromYjs) : [];
                    });
                    return slice;
                });
            }
        }
    }

    const yLegend = ymap.get('legend');
    if (yLegend) {
        const legendData = typeof yLegend.toJSON === 'function' ? yLegend.toJSON() : yLegend;
        if (Array.isArray(legendData)) {
            _state.legend = legendData.map(entry => ({
                id: entry.id,
                color: entry.color || CARD_COLORS.yellow,
                label: entry.label || ''
            }));
        }
    }

    // Sync partial maps
    const yPartialMaps = ymap.get('partialMaps');
    if (yPartialMaps) {
        try {
            const pmData = typeof yPartialMaps === 'string' ? JSON.parse(yPartialMaps) : yPartialMaps;
            if (Array.isArray(pmData)) _state.partialMaps = pmData;
        } catch { /* ignore parse errors */ }
    }

    // Migrate old string-based notes into Y.Text if needed
    _notepad.migrateLegacyNotes(ymap, ydoc.getText('notes'), _state);

    if (_dom.boardName) _dom.boardName.value = _state.name;

    const newHash = stateHash();
    if (newHash === lastSyncedHash) return false;
    lastSyncedHash = newHash;
    return true;
};

const syncYArray = (yArray, items, getId, createFn, updateFn) => {
    const structureMatches = items.length === yArray.length &&
        items.every((item, i) => {
            const yItem = yArray.get(i);
            return yItem && typeof yItem.get === 'function' && yItem.get('id') === getId(item);
        });

    if (structureMatches) {
        items.forEach((item, i) => {
            const yItem = yArray.get(i);
            updateFn(yItem, item);
        });
    } else {
        while (yArray.length > 0) {
            yArray.delete(0);
        }
        items.forEach(item => {
            yArray.push([createFn(item)]);
        });
    }
};

const syncSliceStories = (yStories, slice, columns) => {
    columns.forEach(col => {
        const stories = slice.stories[col.id] || [];
        let yStoryArray = yStories.get(col.id);

        if (!yStoryArray || typeof yStoryArray.toArray !== 'function') {
            yStoryArray = new Y.Array();
            yStories.set(col.id, yStoryArray);
        }

        syncYArray(
            yStoryArray,
            stories,
            story => story.id,
            createYStory,
            updateYStory
        );
    });

    const columnIds = new Set(columns.map(c => c.id));
    const keysToDelete = [];
    yStories.forEach((_, key) => {
        if (!columnIds.has(key)) keysToDelete.push(key);
    });
    keysToDelete.forEach(key => yStories.delete(key));
};

const updateYSlice = (ySlice, slice, columns) => {
    if (ySlice.get('name') !== (slice.name || '')) ySlice.set('name', slice.name || '');
    // Clean up old v1 fields if present
    if (ySlice.get('separator') !== undefined) ySlice.delete('separator');
    if (ySlice.get('rowType') !== undefined) ySlice.delete('rowType');
    if (ySlice.get('collapsed') !== slice.collapsed) {
        if (slice.collapsed) ySlice.set('collapsed', true);
        else ySlice.delete('collapsed');
    }
    if (ySlice.get('closedReason') !== (slice.closedReason || undefined)) {
        if (slice.closedReason) ySlice.set('closedReason', slice.closedReason);
        else ySlice.delete('closedReason');
    }

    let yStories = ySlice.get('stories');
    if (!yStories || typeof yStories.forEach !== 'function') {
        yStories = new Y.Map();
        ySlice.set('stories', yStories);
    }
    syncSliceStories(yStories, slice, columns);
};

const syncBackboneRow = (yRow, cardMap, columns) => {
    columns.forEach(col => {
        const cards = cardMap[col.id] || [];
        let yCardArray = yRow.get(col.id);

        if (!yCardArray || typeof yCardArray.toArray !== 'function') {
            yCardArray = new Y.Array();
            yRow.set(col.id, yCardArray);
        }

        syncYArray(
            yCardArray,
            cards,
            card => card.id,
            createYCard,
            updateYCard
        );
    });

    // Remove columns that no longer exist
    const columnIds = new Set(columns.map(c => c.id));
    const keysToDelete = [];
    yRow.forEach((_, key) => {
        if (!columnIds.has(key)) keysToDelete.push(key);
    });
    keysToDelete.forEach(key => yRow.delete(key));
};

export const syncToYjs = () => {
    if (!ymap || isSyncingFromRemote) return;

    if (_state.mapId && !_isMapEditable()) return;

    const currentHash = stateHash();
    if (currentHash === lastSyncedHash) return;
    lastSyncedHash = currentHash;

    ydoc.transact(() => {
        ymap.set('name', _state.name);

        let yColumns = ymap.get('columns');
        if (!yColumns || typeof yColumns.toArray !== 'function') {
            yColumns = new Y.Array();
            ymap.set('columns', yColumns);
        }
        syncYArray(
            yColumns,
            _state.columns,
            col => col.id,
            createYColumn,
            updateYColumn
        );

        // Sync users and activities as separate Yjs maps
        let yUsers = ymap.get('users');
        if (!yUsers || typeof yUsers.forEach !== 'function') {
            yUsers = new Y.Map();
            ymap.set('users', yUsers);
        }
        syncBackboneRow(yUsers, _state.users, _state.columns);

        let yActivities = ymap.get('activities');
        if (!yActivities || typeof yActivities.forEach !== 'function') {
            yActivities = new Y.Map();
            ymap.set('activities', yActivities);
        }
        syncBackboneRow(yActivities, _state.activities, _state.columns);

        // Sync slices (releases only — no more Users/Activities in here)
        let ySlices = ymap.get('slices');
        if (!ySlices || typeof ySlices.toArray !== 'function') {
            ySlices = new Y.Array();
            ymap.set('slices', ySlices);
        }

        const sliceStructureMatches = _state.slices.length === ySlices.length &&
            _state.slices.every((slice, i) => {
                const ySlice = ySlices.get(i);
                return ySlice && typeof ySlice.get === 'function' && ySlice.get('id') === slice.id;
            });

        if (sliceStructureMatches) {
            _state.slices.forEach((slice, i) => {
                const ySlice = ySlices.get(i);
                updateYSlice(ySlice, slice, _state.columns);
            });
        } else {
            while (ySlices.length > 0) {
                ySlices.delete(0);
            }
            _state.slices.forEach(slice => {
                ySlices.push([createYSlice(slice, _state.columns)]);
            });
        }

        let yLegend = ymap.get('legend');
        if (!yLegend || typeof yLegend.toArray !== 'function') {
            yLegend = new Y.Array();
            ymap.set('legend', yLegend);
        }
        syncYArray(
            yLegend,
            _state.legend,
            entry => entry.id,
            createYLegendEntry,
            updateYLegendEntry
        );
        // Sync partial maps as JSON string
        const pmJson = JSON.stringify(_state.partialMaps);
        const currentPm = ymap.get('partialMaps');
        if (currentPm !== pmJson) {
            ymap.set('partialMaps', pmJson);
        }

        // Sync notes into Y.Text if it's empty and state has notes
        const ytext = ydoc.getText('notes');
        if (ytext.length === 0 && _state.notes) {
            ytext.insert(0, _state.notes);
        }
    }, 'local');
};

// =============================================================================
// Document lifecycle
// =============================================================================

export const createYjsDoc = async (mapId) => {
    await loadYjs();
    if (ydoc) {
        ydoc.destroy();
    }
    if (provider) {
        provider.destroy();
        provider = null;
    }
    ydoc = new Y.Doc();
    ymap = ydoc.getMap('storymap');

    // Observe remote ymap changes → update state + re-render (leading+trailing throttle)
    ymap.observeDeep((events) => {
        const isRemote = events.some(e => e.transaction.origin !== null && e.transaction.origin !== 'local');
        if (isRemote) {
            if (!_remoteRenderTimer) {
                // First event: render immediately for responsiveness
                isSyncingFromRemote = true;
                try {
                    const changed = syncFromYjs();
                    if (changed) { if (_setPreserveToolbar) _setPreserveToolbar(true); _render(); }
                } finally { isSyncingFromRemote = false; }
                _hasNewRemoteEvents = false;
            } else {
                _hasNewRemoteEvents = true;
            }
            // Schedule trailing render - resets on each event
            clearTimeout(_remoteRenderTimer);
            _remoteRenderTimer = setTimeout(() => {
                _remoteRenderTimer = null;
                if (!_hasNewRemoteEvents) return;
                _hasNewRemoteEvents = false;
                isSyncingFromRemote = true;
                try {
                    const changed = syncFromYjs();
                    if (changed) { if (_setPreserveToolbar) _setPreserveToolbar(true); _render(); }
                } finally { isSyncingFromRemote = false; }
            }, 100);
        }
    });

    // Connect via WebSocket
    if (mapId) {
        const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        provider = new WebsocketProvider(`${wsProto}//${location.host}`, mapId, ydoc);

        // Wait for initial sync (timeout after 10s to avoid hanging forever)
        await new Promise(resolve => {
            if (provider.synced) return resolve();
            const timeout = setTimeout(resolve, 10_000);
            provider.once('sync', () => { clearTimeout(timeout); resolve(); });
        });
        // Seed Yjs from state for new maps (samples, imports, copies)
        const ytext = ydoc.getText('notes');
        if (ytext.length === 0 && _state.notes) {
            ydoc.transact(() => {
                ytext.insert(0, _state.notes);
            }, 'local');
        }
        if (!ymap.get('columns') && _state.columns?.length) {
            syncToYjs();
        }
        _notepad.bindYjs(ydoc, ytext, provider);
        _log.bindYjs(ydoc, provider, mapId);
    }

    return ydoc;
};

export const destroyYjs = () => {
    if (_remoteRenderTimer) {
        clearTimeout(_remoteRenderTimer);
        _remoteRenderTimer = null;
    }
    _hasNewRemoteEvents = false;
    if (provider) {
        provider.destroy();
        provider = null;
    }
    if (ydoc) {
        _notepad.unbindYjs();
        _log.unbindYjs();
        ydoc.destroy();
        ydoc = null;
        ymap = null;
    }
};
