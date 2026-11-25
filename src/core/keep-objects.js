// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Keeping the objects the map already has when the whole map is read in again, after a change from
// someone else or an undo. The cards on screen and an open card hold on to those objects, so an
// edit made before the map is next drawn still lands on the map, and a redraw can tell which cards
// have not changed (see src/ui/keep.js).

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Every object with an ID under value, by ID
const collectById = (value, found = new Map()) => {
    if (Array.isArray(value)) value.forEach(item => collectById(item, found));
    else if (isPlainObject(value)) {
        if (value.id != null && !found.has(value.id)) found.set(value.id, value);
        Object.values(value).forEach(child => collectById(child, found));
    }
    return found;
};

// Make what the map had (existing) equal to what was just read (fresh), keeping the objects and
// lists it already had. The cards and slices on screen hold on to those objects, and so does a
// card that is open, so an edit made before the map is next drawn still lands on the map. An
// object with an ID is reused wherever it now is, once; a second copy gets a new object.
const keepObjects = (existing, fresh, byId) => {
    if (Array.isArray(fresh)) {
        const items = fresh.map(item => keepObjects(undefined, item, byId));
        if (!Array.isArray(existing)) return items;
        existing.length = 0;
        existing.push(...items);
        return existing;
    }
    if (!isPlainObject(fresh)) return fresh;
    let kept = null;
    if (fresh.id != null) {
        kept = byId.get(fresh.id) || null;
        byId.delete(fresh.id);
    } else if (isPlainObject(existing) && existing.id == null) {
        kept = existing;
    }
    kept ||= {};
    for (const key of Object.keys(kept)) {
        if (!(key in fresh)) delete kept[key];
    }
    for (const key of Object.keys(fresh)) kept[key] = keepObjects(kept[key], fresh[key], byId);
    return kept;
};

const KEPT_KEYS = ['columns', 'users', 'activities', 'slices', 'legend', 'partialMaps'];

// What the map holds now, to pass to keepHeldObjects once it has been read in again
export const heldObjects = (state) => Object.fromEntries(KEPT_KEYS.map(key => [key, state[key]]));

// After the map was read in again: make it hold the objects it had before, with their new values
export const keepHeldObjects = (state, before) => {
    const reread = KEPT_KEYS.filter(key => state[key] !== before[key]);
    const byId = collectById(reread.map(key => before[key]));
    for (const key of reread) state[key] = keepObjects(before[key], state[key], byId);
};
