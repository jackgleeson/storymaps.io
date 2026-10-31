// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Recent maps: the maps opened in this browser, reached from a line under Start Mapping on the
// home page and from Recent maps in the main menu, for people who go straight to their maps. The
// list stays in this browser and is never sent to the server.

import { dom } from '/src/ui/dom.js';
import { state } from '/src/core/state.js';
import { el } from '/src/core/constants.js';
import { showConfirm } from '/src/core/modals.js';
import { parseLocation } from '/src/core/project-links.js';
import { readRecent, writeRecent, withEntry, entryPath, openedAgo } from '/src/core/recent-maps.js';
import * as projects from '/src/features/projects.js';

const MENU_LIMIT = 8;

const ICONS = {
    map: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="5" height="5" rx="1"/><rect x="10" y="4" width="5" height="5" rx="1"/><rect x="17" y="4" width="4" height="5" rx="1"/><rect x="3" y="12" width="5" height="4" rx="1"/><rect x="10" y="12" width="5" height="4" rx="1"/><rect x="3" y="18" width="5" height="3" rx="1"/></svg>',
    project: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/></svg>',
    cross: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

let _pop = null;     // the list under the home page line, while open
let _shade = null;   // behind the list on a phone
let _nameTimer = null;

const label = (e) => e.name || (e.kind === 'project' ? 'Untitled project' : 'Untitled map');

// The entry for what is open now: the project around the map when the address names one, or the
// map by itself. Null until the project is known, so a project map isn't kept as a lone map.
const openEntry = () => {
    if (!state.mapId) return null;
    const where = parseLocation(location.pathname);
    if (where.mapId !== state.mapId) return null;
    if (!where.projectId) return { kind: 'map', id: state.mapId, name: state.name || '' };
    const project = projects.current();
    if (project?.id !== where.projectId) return null;
    return { kind: 'project', id: project.id, name: project.name, mapId: state.mapId, maps: project.mapCount };
};

const isOpen = (e) => {
    const open = openEntry();
    return !!open && open.kind === e.kind && open.id === e.id;
};

// Keep the open map, or its project, first in the list. A map in a project is kept as the
// project, so it doesn't show twice.
export const noteOpened = () => {
    const entry = openEntry();
    if (!entry) return;
    let list = readRecent();
    if (entry.kind === 'project') list = list.filter(e => !(e.kind === 'map' && e.id === entry.mapId));
    writeRecent(withEntry(list, { ...entry, at: Date.now() }));
    updateHomeLine();
};

// The title changes as people type; keep the name in the list once they pause
const noteRenamed = () => {
    clearTimeout(_nameTimer);
    _nameTimer = setTimeout(noteOpened, 600);
};

// A map the server no longer has, and any project entry that would reopen on it
export const forgetMap = (mapId) => {
    writeRecent(readRecent().filter(e => !(e.kind === 'map' && e.id === mapId) && !(e.kind === 'project' && e.mapId === mapId)));
    updateHomeLine();
};

export const forgetProject = (projectId) => {
    writeRecent(readRecent().filter(e => !(e.kind === 'project' && e.id === projectId)));
    updateHomeLine();
};

const removeFromList = (entry) => {
    writeRecent(readRecent().filter(e => !(e.kind === entry.kind && e.id === entry.id)));
    updateHomeLine();
};

const clearList = async () => {
    closeList({ restoreFocus: false });
    dom.mainMenu?.classList.remove('visible');
    document.body.classList.remove('main-menu-open');
    if (!await showConfirm('Clear the list of recent maps?\n\nThe maps aren\'t deleted, and still open from their links.')) return;
    writeRecent([]);
    updateHomeLine();
};

const entryParts = (e, now) => {
    const name = el('span', 'recent-name', { text: label(e), title: label(e) });
    if (e.kind === 'project' && e.maps) name.append(el('span', 'recent-count', { text: ` (${e.maps})` }));
    return [
        el('span', `recent-icon recent-icon-${e.kind}`, { html: ICONS[e.kind] }),
        name,
        el('span', 'recent-when', { text: openedAgo(e.at, now) }),
    ];
};

// =============================================================================
// Home page: a line under Start Mapping, opening the list
// =============================================================================

export const updateHomeLine = () => {
    if (!dom.recentMapsBtn) return;
    dom.recentMapsBtn.hidden = readRecent().length === 0;
    if (_pop) renderList();
};

const renderList = () => {
    const list = readRecent();
    if (!list.length) {
        closeList();
        return;
    }
    const now = Date.now();
    const rows = list.map((e) => {
        const link = el('a', `recent-row recent-row-${e.kind}`, { href: entryPath(e) });
        link.append(...entryParts(e, now));
        const remove = el('button', 'recent-remove', { type: 'button', html: ICONS.cross, title: 'Remove from this list', ariaLabel: `Remove ${label(e)} from recent maps` });
        remove.addEventListener('click', () => {
            // Keep the keyboard in the list, on the row that takes this one's place
            const row = remove.closest('li');
            const next = (row.nextElementSibling || row.previousElementSibling)?.querySelector('a').getAttribute('href');
            removeFromList(e);
            if (next) _pop?.querySelector(`a[href="${CSS.escape(next)}"]`)?.focus();
        });
        const item = el('li', 'recent-item');
        item.append(link, remove);
        return item;
    });
    const clear = el('button', 'recent-clear', { type: 'button', text: 'Clear list' });
    clear.addEventListener('click', clearList);
    const foot = el('p', 'recent-foot');
    foot.append(el('span', '', { text: 'Bookmark maps you want to keep.' }), clear);
    const ul = el('ul', 'recent-list');
    ul.append(...rows);
    _pop.replaceChildren(el('p', 'recent-title', { id: 'recentMapsTitle', text: 'Recently opened in this browser' }), ul, foot);
};

const placeList = () => {
    if (!_pop) return;
    if (window.matchMedia('(max-width: 600px)').matches) {
        _pop.style.left = '';
        _pop.style.top = '';
        return;
    }
    const at = dom.recentMapsBtn.getBoundingClientRect();
    const width = _pop.offsetWidth;
    const left = Math.max(8, Math.min(at.left + at.width / 2 - width / 2, document.documentElement.clientWidth - width - 8));
    _pop.style.left = `${left + window.scrollX}px`;
    _pop.style.top = `${at.bottom + window.scrollY + 6}px`;
};

const openList = () => {
    if (_pop) return;
    _shade = el('div', 'recent-shade');
    _shade.addEventListener('click', () => closeList());
    _pop = el('div', 'recent-pop', { id: 'recentMapsPop', role: 'dialog', ariaLabelledby: 'recentMapsTitle', tabIndex: -1 });
    _pop.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            closeList();
        }
    });
    document.body.append(_shade, _pop);
    renderList();
    if (!_pop) return;
    placeList();
    dom.recentMapsBtn.setAttribute('aria-expanded', 'true');
    dom.recentMapsBtn.classList.add('open');
    (_pop.querySelector('a') || _pop).focus();
};

const closeList = ({ restoreFocus = true } = {}) => {
    if (!_pop) return;
    _pop.remove();
    _shade?.remove();
    _pop = null;
    _shade = null;
    dom.recentMapsBtn?.setAttribute('aria-expanded', 'false');
    dom.recentMapsBtn?.classList.remove('open');
    if (restoreFocus) dom.recentMapsBtn?.focus();
};

// =============================================================================
// Main menu: Recent maps, without the map that's open
// =============================================================================

export const fillMenu = () => {
    const wrap = dom.recentSubmenuWrap;
    if (!wrap) return;
    const list = readRecent().filter(e => !isOpen(e));
    wrap.hidden = list.length === 0;
    const now = Date.now();
    const items = list.slice(0, MENU_LIMIT).map((e) => {
        const link = el('a', `dropdown-item recent-menu-item recent-row-${e.kind}`, { href: entryPath(e) });
        link.append(...entryParts(e, now));
        return link;
    });
    const clear = el('button', 'dropdown-item recent-menu-clear', { type: 'button', text: 'Clear list' });
    clear.addEventListener('click', (e) => {
        e.stopPropagation();
        clearList();
    });
    dom.recentSubmenu.replaceChildren(...items, clear);
};

// Follow renames of the open map
export const watch = (ymap) => {
    ymap?.observe((event) => {
        if (event.keysChanged.has('name')) noteRenamed();
    });
};

export const initListeners = () => {
    dom.recentMapsBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (_pop) closeList();
        else openList();
    });
    document.addEventListener('pointerdown', (e) => {
        if (_pop && !_pop.contains(e.target) && !dom.recentMapsBtn.contains(e.target) && !e.target.closest?.('.modal-overlay, .modal')) closeList({ restoreFocus: false });
    });
    window.addEventListener('resize', placeList);
    dom.boardName.addEventListener('input', noteRenamed);
    projects.onShown(noteOpened);
    updateHomeLine();
};
