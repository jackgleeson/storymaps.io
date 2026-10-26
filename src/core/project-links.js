// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Pure helpers for project tabs

// The most maps a project holds, the same limit as the server
export const MAX_PROJECT_MAPS = 20;

// Same characters the server allows in a map ID
const MAP_ID = /^[a-zA-Z0-9_-]{1,64}$/;
// Paths the app uses for something other than a map
const RESERVED = new Set(['new', 'tour', 'sample', 'api', 'src', 'samples', 'resources', 'vendor']);

const PROJECT_PATH = /^\/p\/([a-zA-Z0-9_-]{1,64})(?:\/([a-zA-Z0-9_-]{1,64}))?\/?$/;

// The map and project a page address points at. /p/<project>/<map> is a map shown with the
// tabs of a project, /p/<project> is a project before a map opens, and /<map> is a map by
// itself.
export const parseLocation = (pathname) => {
    const match = (pathname || '').match(PROJECT_PATH);
    if (match) return { projectId: match[1], mapId: match[2] || null };
    return { projectId: null, mapId: (pathname || '').slice(1) || null };
};

// The address of a map shown with the tabs of a project
export const projectPath = (projectId, mapId) => `/p/${encodeURIComponent(projectId)}/${encodeURIComponent(mapId)}`;

// The map ID in a pasted link ("https://storymaps.io/abc123", "storymaps.io/abc123#slice-x",
// a project link ending in a map) or a bare ID, or null when the text doesn't name one map
export const parseMapId = (text) => {
    const value = (text || '').trim();
    if (!value) return null;
    let id = value;
    if (/[/.:]/.test(value)) {
        let url;
        try {
            url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
        } catch {
            return null;
        }
        if (!/^https?:$/.test(url.protocol)) return null;
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts.length === 3 && parts[0] === 'p') id = parts[2];
        else if (parts.length === 1) id = parts[0];
        else return null;
    }
    return MAP_ID.test(id) && !RESERVED.has(id) ? id : null;
};

// A copy of the list with the item at index moved by delta places, or null when it can't move
export const moveItem = (list, index, delta) => {
    const to = index + delta;
    if (index < 0 || index >= list.length || to < 0 || to >= list.length) return null;
    const copy = list.slice();
    const [item] = copy.splice(index, 1);
    copy.splice(to, 0, item);
    return copy;
};
