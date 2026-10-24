// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Serialization / deserialization (pure functions)

import { CARD_COLORS, isValidUrl, copySliceDetails } from '/src/core/constants.js';
import { state, createColumn, createStory, createRefColumn } from '/src/core/state.js';
import { generateId } from '/src/core/constants.js';

// Sanitize URL - only allow valid http/https URLs
const sanitizeUrl = (url) => isValidUrl(url) ? url : null;

const serializeCard = (card) => {
    const obj = { name: card.name };
    if (card.body) obj.body = card.body;
    if (card.color) obj.color = card.color;
    if (card.url) obj.url = card.url;
    if (card.hidden) obj.hidden = true;
    if (card.status) obj.status = card.status;
    if (card.points != null) obj.points = card.points;
    if (card.tags?.length) obj.tags = card.tags;
    return obj;
};

const deserializeCard = (obj) => {
    return createStory(
        obj.name || obj.n || '',
        obj.color || obj.c || null,
        sanitizeUrl(obj.url || obj.u),
        !!(obj.hidden || obj.h),
        obj.status || obj.st || null,
        ((v) => v != null ? Number(v) : null)(obj.points ?? obj.sp ?? null),
        Array.isArray(obj.tags || obj.tg) ? (obj.tags || obj.tg) : [],
        obj.body || obj.b || ''
    );
};

const deserializeColumn = (obj) => {
    return createColumn(
        obj.name || obj.n || '',
        obj.color || obj.c || null,
        sanitizeUrl(obj.url || obj.u),
        !!(obj.hidden || obj.h),
        obj.status || obj.st || null,
        ((v) => v != null ? Number(v) : null)(obj.points ?? obj.sp ?? null),
        Array.isArray(obj.tags || obj.tg) ? (obj.tags || obj.tg) : [],
        obj.body || obj.b || ''
    );
};

export const serialize = () => ({
    app: 'storymap',
    v: 1,
    exported: new Date().toISOString(),
    name: state.name,
    ...(state.mapId && { id: state.mapId }),
    site: window.location.hostname,
    users: state.columns.map(col => (state.users[col.id] || []).map(serializeCard)),
    activities: state.columns.map(col => (state.activities[col.id] || []).map(serializeCard)),
    steps: state.columns.map(col => {
        if (col.partialMapId) {
            const obj = { partialMapId: col.partialMapId };
            if (col.partialMapOrigin) obj.partialMapOrigin = true;
            return obj;
        }
        return serializeCard(col);
    }),
    slices: state.slices.map(slice => {
        const obj = {
            name: slice.name,
            stories: state.columns.map(col => (slice.stories[col.id] || []).map(serializeCard))
        };
        if (slice.collapsed) obj.collapsed = true;
        if (slice.closedReason) obj.closedReason = slice.closedReason;
        copySliceDetails(slice, obj);
        return obj;
    }),
    ...(state.legend.length > 0 && {
        legend: state.legend.map(entry => ({ color: entry.color, label: entry.label }))
    }),
    ...(state.notes && { notes: state.notes }),
    ...(state.partialMaps.length > 0 && {
        partialMaps: state.partialMaps.map(pm => ({
            id: pm.id,
            name: pm.name,
            users: pm.columns.map(c => (pm.users?.[c.id] || []).map(serializeCard)),
            activities: pm.columns.map(c => (pm.activities?.[c.id] || []).map(serializeCard)),
            steps: pm.columns.map(serializeCard),
            stories: state.slices.map(slice =>
                pm.columns.map(c => (pm.stories[slice.id]?.[c.id] || []).map(serializeCard))
            )
        }))
    })
});

const deserializeV1 = (data) => {
    state.name = data.name || '';
    state.columns = (data.steps || []).map(step => {
        if (step.partialMapId) return createRefColumn(step.partialMapId, !!step.partialMapOrigin);
        return deserializeColumn(step);
    });

    // Users: positional array → keyed by column ID
    state.users = {};
    const usersArr = Array.isArray(data.users) ? data.users : [];
    state.columns.forEach((col, i) => {
        state.users[col.id] = (usersArr[i] || []).map(deserializeCard);
    });

    // Activities: positional array → keyed by column ID
    state.activities = {};
    const activitiesArr = Array.isArray(data.activities) ? data.activities : [];
    state.columns.forEach((col, i) => {
        state.activities[col.id] = (activitiesArr[i] || []).map(deserializeCard);
    });

    // Slices (releases only)
    state.slices = (data.slices || []).map(slice => {
        const newSlice = {
            id: generateId(),
            name: slice.name || '',
            collapsed: !!slice.collapsed,
            stories: {}
        };
        if (slice.closedReason) newSlice.closedReason = slice.closedReason;
        copySliceDetails(slice, newSlice);
        const stories = Array.isArray(slice.stories) ? slice.stories : [];
        state.columns.forEach((col, i) => {
            newSlice.stories[col.id] = (stories[i] || []).map(deserializeCard);
        });
        return newSlice;
    });

    state.legend = Array.isArray(data.legend) ? data.legend.map(entry => ({
        id: generateId(),
        color: entry.color || CARD_COLORS.yellow,
        label: entry.label || ''
    })) : [];
    state.notes = data.notes || '';

    // Deserialize partial maps (positional arrays, like main map)
    state.partialMaps = Array.isArray(data.partialMaps) ? data.partialMaps.map(pm => {
        const columns = (pm.steps || []).map(deserializeColumn);
        const users = {};
        const activities = {};
        const stories = {};
        const usersArr = Array.isArray(pm.users) ? pm.users : [];
        columns.forEach((col, i) => {
            users[col.id] = (usersArr[i] || []).map(deserializeCard);
        });
        const activitiesArr = Array.isArray(pm.activities) ? pm.activities : [];
        columns.forEach((col, i) => {
            activities[col.id] = (activitiesArr[i] || []).map(deserializeCard);
        });
        const storiesArr = Array.isArray(pm.stories) ? pm.stories : [];
        state.slices.forEach((slice, si) => {
            const sliceStories = storiesArr[si] || [];
            stories[slice.id] = {};
            columns.forEach((col, ci) => {
                stories[slice.id][col.id] = (sliceStories[ci] || []).map(deserializeCard);
            });
        });
        return { id: pm.id || generateId(), name: pm.name || '', columns, users, activities, stories };
    }) : [];
};

const deserializeLegacy = (data) => {
    state.name = data.name || '';
    state.columns = data.a.map(a => deserializeColumn(a));

    // Extract Users/Activities from legacy slices, put remaining into release slices
    state.users = {};
    state.activities = {};
    state.columns.forEach(col => {
        state.users[col.id] = [];
        state.activities[col.id] = [];
    });

    state.slices = [];
    data.s.forEach(slice => {
        const rowType = slice.rt || null;
        const stories = Array.isArray(slice.t) ? slice.t : [];

        if (rowType === 'Users') {
            state.columns.forEach((col, i) => {
                state.users[col.id] = (stories[i] || []).map(deserializeCard);
            });
        } else if (rowType === 'Activities') {
            state.columns.forEach((col, i) => {
                state.activities[col.id] = (stories[i] || []).map(deserializeCard);
            });
        } else {
            const newSlice = {
                id: generateId(),
                name: slice.n || '',
                collapsed: !!slice.col,
                stories: {}
            };
            state.columns.forEach((col, i) => {
                newSlice.stories[col.id] = (stories[i] || []).map(deserializeCard);
            });
            state.slices.push(newSlice);
        }
    });

    state.legend = Array.isArray(data.l) ? data.l.map(entry => ({
        id: generateId(),
        color: entry.c || CARD_COLORS.yellow,
        label: entry.n || ''
    })) : [];
    state.notes = data.notes || '';
    state.partialMaps = [];
};

export const appendImport = (data) => {
    const newCols = (data.steps || []).map(deserializeColumn);

    // Insert a hidden spacer column before the appended content
    const spacer = state.columns.length > 0 ? createColumn() : null;
    if (spacer) spacer.hidden = true;
    if (spacer) state.columns.push(spacer);

    // Append columns
    state.columns.push(...newCols);

    // Initialize spacer column with empty arrays
    if (spacer) {
        state.users[spacer.id] = [];
        state.activities[spacer.id] = [];
        state.slices.forEach(s => { s.stories[spacer.id] = []; });
    }

    // Append users/activities for new columns (existing ones untouched)
    const usersArr = Array.isArray(data.users) ? data.users : [];
    const activitiesArr = Array.isArray(data.activities) ? data.activities : [];
    newCols.forEach((col, i) => {
        state.users[col.id] = (usersArr[i] || []).map(deserializeCard);
        state.activities[col.id] = (activitiesArr[i] || []).map(deserializeCard);
    });

    // Append new slices, merging into existing slices with matching names
    (data.slices || []).forEach(slice => {
        const sliceName = slice.name || '';
        const existing = state.slices.find(s => s.name === sliceName);

        if (existing) {
            // Merge: add stories for new columns into existing slice
            newCols.forEach((col, i) => {
                const stories = Array.isArray(slice.stories) ? slice.stories : [];
                existing.stories[col.id] = (stories[i] || []).map(deserializeCard);
            });
        } else {
            // Create new slice with empty cells for pre-existing columns
            const newSlice = {
                id: generateId(),
                name: sliceName,
                collapsed: false,
                stories: {}
            };
            state.columns.forEach(col => {
                const newColIndex = newCols.indexOf(col);
                if (newColIndex === -1) {
                    newSlice.stories[col.id] = [];
                } else {
                    const stories = Array.isArray(slice.stories) ? slice.stories : [];
                    newSlice.stories[col.id] = (stories[newColIndex] || []).map(deserializeCard);
                }
            });
            state.slices.push(newSlice);
        }
    });

    // Existing slices need empty arrays for new columns
    state.slices.forEach(slice => {
        newCols.forEach(col => {
            if (!slice.stories[col.id]) slice.stories[col.id] = [];
        });
    });
};

export const deserialize = (data) => {
    if (data?.app !== 'storymap') {
        throw new Error('Invalid format');
    }

    // Legacy format: compact keys (a = steps, s = slices)
    if (Array.isArray(data.a) && Array.isArray(data.s)) {
        deserializeLegacy(data);
        return;
    }

    // v1: human-readable keys
    if (Array.isArray(data.steps) && Array.isArray(data.slices)) {
        deserializeV1(data);
        return;
    }

    throw new Error('Unknown format');
};
