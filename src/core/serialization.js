// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Serialization / deserialization (pure functions)

import { CARD_COLORS, DEFAULT_CARD_COLORS, isValidUrl, copySliceDetails, normalizePoints } from '/src/core/constants.js';
import { state, createColumn, createStory, createRefColumn, STARTER_NAMES } from '/src/core/state.js';
import { generateId } from '/src/core/constants.js';

// Sanitize URL - only allow valid http/https URLs
const sanitizeUrl = (url) => isValidUrl(url) ? url : null;

// A user or activity card in the colour of its row (red or blue) is written without it, and gets
// it back when read, as a card with no colour does
const USER_COLOR = DEFAULT_CARD_COLORS.Users;
const ACTIVITY_COLOR = DEFAULT_CARD_COLORS.Activities;

const serializeCard = (card, rowColor = null) => {
    const obj = { name: card.name };
    if (card.body) obj.body = card.body;
    if (card.color && card.color.toLowerCase() !== rowColor) obj.color = card.color;
    if (card.url) obj.url = card.url;
    if (card.hidden) obj.hidden = true;
    if (card.status) obj.status = card.status;
    if (card.points != null) obj.points = card.points;
    if (card.tags?.length) obj.tags = card.tags;
    return obj;
};

const deserializeCard = (obj, rowColor = null) => {
    return createStory(
        obj.name || obj.n || '',
        obj.color || obj.c || rowColor,
        sanitizeUrl(obj.url || obj.u),
        !!(obj.hidden || obj.h),
        obj.status || obj.st || null,
        normalizePoints(obj.points ?? obj.sp),
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
        normalizePoints(obj.points ?? obj.sp),
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
    // The site with its port, if it has one, as the server writes it, so the CLI finds the same
    // server again and never guesses a port
    site: window.location.host,
    users: state.columns.map(col => (state.users[col.id] || []).map(c => serializeCard(c, USER_COLOR))),
    activities: state.columns.map(col => (state.activities[col.id] || []).map(c => serializeCard(c, ACTIVITY_COLOR))),
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
            stories: state.columns.map(col => (slice.stories[col.id] || []).map(c => serializeCard(c)))
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
            users: pm.columns.map(c => (pm.users?.[c.id] || []).map(c => serializeCard(c, USER_COLOR))),
            activities: pm.columns.map(c => (pm.activities?.[c.id] || []).map(c => serializeCard(c, ACTIVITY_COLOR))),
            steps: pm.columns.map(c => serializeCard(c)),
            stories: state.slices.map(slice =>
                pm.columns.map(c => (pm.stories[slice.id]?.[c.id] || []).map(c => serializeCard(c)))
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
        state.users[col.id] = (usersArr[i] || []).map(c => deserializeCard(c, USER_COLOR));
    });

    // Activities: positional array → keyed by column ID
    state.activities = {};
    const activitiesArr = Array.isArray(data.activities) ? data.activities : [];
    state.columns.forEach((col, i) => {
        state.activities[col.id] = (activitiesArr[i] || []).map(c => deserializeCard(c, ACTIVITY_COLOR));
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
            newSlice.stories[col.id] = (stories[i] || []).map(c => deserializeCard(c));
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
            users[col.id] = (usersArr[i] || []).map(c => deserializeCard(c, USER_COLOR));
        });
        const activitiesArr = Array.isArray(pm.activities) ? pm.activities : [];
        columns.forEach((col, i) => {
            activities[col.id] = (activitiesArr[i] || []).map(c => deserializeCard(c, ACTIVITY_COLOR));
        });
        const storiesArr = Array.isArray(pm.stories) ? pm.stories : [];
        state.slices.forEach((slice, si) => {
            const sliceStories = storiesArr[si] || [];
            stories[slice.id] = {};
            columns.forEach((col, ci) => {
                stories[slice.id][col.id] = (sliceStories[ci] || []).map(c => deserializeCard(c));
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
                state.users[col.id] = (stories[i] || []).map(c => deserializeCard(c, USER_COLOR));
            });
        } else if (rowType === 'Activities') {
            state.columns.forEach((col, i) => {
                state.activities[col.id] = (stories[i] || []).map(c => deserializeCard(c, ACTIVITY_COLOR));
            });
        } else {
            const newSlice = {
                id: generateId(),
                name: slice.n || '',
                collapsed: !!slice.col,
                stories: {}
            };
            state.columns.forEach((col, i) => {
                newSlice.stories[col.id] = (stories[i] || []).map(c => deserializeCard(c));
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
        state.users[col.id] = (usersArr[i] || []).map(c => deserializeCard(c, USER_COLOR));
        state.activities[col.id] = (activitiesArr[i] || []).map(c => deserializeCard(c, ACTIVITY_COLOR));
    });

    // Append new slices, merging into existing slices with matching names
    (data.slices || []).forEach(slice => {
        const sliceName = slice.name || '';
        const existing = state.slices.find(s => s.name === sliceName);

        if (existing) {
            // Merge: add stories for new columns into existing slice
            newCols.forEach((col, i) => {
                const stories = Array.isArray(slice.stories) ? slice.stories : [];
                existing.stories[col.id] = (stories[i] || []).map(c => deserializeCard(c));
            });
        } else {
            // Create new slice with empty cells for pre-existing columns
            const newSlice = {
                id: generateId(),
                name: sliceName,
                collapsed: !!slice.collapsed,
                stories: {}
            };
            if (slice.closedReason) newSlice.closedReason = slice.closedReason;
            copySliceDetails(slice, newSlice);
            state.columns.forEach(col => {
                const newColIndex = newCols.indexOf(col);
                if (newColIndex === -1) {
                    newSlice.stories[col.id] = [];
                } else {
                    const stories = Array.isArray(slice.stories) ? slice.stories : [];
                    newSlice.stories[col.id] = (stories[newColIndex] || []).map(c => deserializeCard(c));
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

// The steps of a backbone that is already there: named by someone, and neither a hidden spacer
// nor a column that belongs to a partial. A step still called New Step hasn't been named yet.
export const backboneSteps = () => state.columns.filter(col => !col.hidden && !col.partialMapId && (col.name || '').trim() && !STARTER_NAMES.has(col.name));

// Imported cards go under a backbone that is already there, in a slice of their own at the
// bottom, so each card is a short drag from the step and release it belongs to. They are dealt
// out across the steps from the left, row by row, in the order they came in. No step, user or
// activity is added. A second import adds to the same slice.
export const appendCardsUnderBackbone = (cards, sliceName = 'Imported') => {
    const steps = backboneSteps();
    if (!steps.length || !cards.length) return false;
    let slice = state.slices.find(s => s.name === sliceName);
    if (!slice) {
        slice = { id: generateId(), name: sliceName, collapsed: false, stories: {} };
        state.columns.forEach(col => { slice.stories[col.id] = []; });
        state.slices.push(slice);
    }
    cards.forEach((card, i) => {
        const col = steps[i % steps.length];
        (slice.stories[col.id] ??= []).push(deserializeCard(card));
    });
    return true;
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
