// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Maps opened in this browser, newest first. The list is kept in localStorage only and never sent
// to the server. A map opened at a project link is kept as its project, which reopens on the map
// last opened there.
//
// An entry is { kind: 'map', id, name, at } or { kind: 'project', id, name, mapId, maps, at },
// where at is when it was last opened, in milliseconds.

export const RECENT_KEY = 'recentMaps';
export const MAX_RECENT = 20;

const ID = /^[a-zA-Z0-9_-]{1,64}$/;

const isId = (id) => typeof id === 'string' && ID.test(id);

const isEntry = (e) => !!e
    && (e.kind === 'map' || (e.kind === 'project' && isId(e.mapId)))
    && isId(e.id)
    && typeof e.at === 'number';

export const readRecent = (storage = globalThis.localStorage) => {
    try {
        const list = JSON.parse(storage.getItem(RECENT_KEY) || '[]');
        return Array.isArray(list) ? list.filter(isEntry) : [];
    } catch {
        return [];
    }
};

export const writeRecent = (list, storage = globalThis.localStorage) => {
    try {
        if (list.length) storage.setItem(RECENT_KEY, JSON.stringify(list));
        else storage.removeItem(RECENT_KEY);
    } catch { /* storage full or blocked: the list just isn't kept */ }
};

const same = (a, kind, id) => a.kind === kind && a.id === id;

// The list with this entry first, in place of an older one for the same map or project
export const withEntry = (list, entry) => [entry, ...list.filter(e => !same(e, entry.kind, entry.id))].slice(0, MAX_RECENT);

export const withoutEntry = (list, kind, id) => list.filter(e => !same(e, kind, id));

// The address an entry opens
export const entryPath = (e) => e.kind === 'project'
    ? `/p/${encodeURIComponent(e.id)}/${encodeURIComponent(e.mapId)}`
    : `/${encodeURIComponent(e.id)}`;

const startOfDay = (time) => {
    const d = new Date(time);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
};

// When an entry was opened, in words: "Just now", "5 min ago", "3h ago", "Yesterday",
// "4 days ago", then a date
export const openedAgo = (at, now = Date.now()) => {
    const minutes = Math.floor((now - at) / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} min ago`;
    const days = Math.round((startOfDay(now) - startOfDay(at)) / 86400000);
    if (days <= 0) return `${Math.floor(minutes / 60)}h ago`;
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    const then = new Date(at);
    const year = then.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {};
    return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...year });
};
