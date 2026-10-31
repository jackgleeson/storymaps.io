// Storymaps.io — AGPL-3.0 — see LICENCE for details
// A reminder to bookmark a map, under the map title, when someone names it here: naming a map is
// when it starts to matter, and with no accounts the link is the only way back to it. A map in a
// project doesn't show it; the project does instead, under the project name, when it is started or
// renamed. Shown once per map or project in this browser; which have shown it is kept in this
// browser only.

import { dom } from '/src/ui/dom.js';
import { state } from '/src/core/state.js';
import { el } from '/src/core/constants.js';
import { parseLocation } from '/src/core/project-links.js';
import * as tour from '/src/features/tour.js';
import * as projects from '/src/features/projects.js';

const SHOWN_KEY = 'bookmarkNudged';
const OFF_KEY = 'bookmarkNudgeOff';
const MAX_SHOWN = 200;

const STAR = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/></svg>';

let _mapId = null;   // the map open now
let _callout = null;
let _anchor = null;  // what the reminder points at: the map title or the project name

const shownFor = () => {
    try {
        const ids = JSON.parse(localStorage.getItem(SHOWN_KEY) || '[]');
        return Array.isArray(ids) ? ids : [];
    } catch {
        return [];
    }
};

// Maps are kept by ID, projects as p:<ID>
const markShown = (key) => {
    try {
        localStorage.setItem(SHOWN_KEY, JSON.stringify([key, ...shownFor().filter(id => id !== key)].slice(0, MAX_SHOWN)));
    } catch { /* storage blocked: it may show again on this map */ }
};

const turnedOff = () => {
    try {
        return localStorage.getItem(OFF_KEY) === '1';
    } catch {
        return false;
    }
};

// How to bookmark on this device
const howTo = () => {
    if (window.matchMedia('(pointer: coarse)').matches) return 'Add this page to your bookmarks.';
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    return `Press ${mac ? 'Cmd' : 'Ctrl'} + D to bookmark it.`;
};

// Under the middle of what it points at, kept inside the screen
const place = () => {
    if (!_callout) return;
    const title = _anchor.getBoundingClientRect();
    const width = _callout.offsetWidth;
    const centre = title.left + title.width / 2;
    const left = Math.max(8, Math.min(centre - width / 2, document.documentElement.clientWidth - width - 8));
    _callout.style.left = `${left + window.scrollX}px`;
    _callout.style.top = `${title.bottom + window.scrollY + 10}px`;
    _callout.style.setProperty('--arrow-left', `${centre - left}px`);
};

const hide = () => {
    _callout?.remove();
    _callout = null;
};

const show = ({ what, text, link, anchor }) => {
    _anchor = anchor;
    const copy = el('button', 'bookmark-nudge-button', { type: 'button', text: 'Copy link' });
    copy.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(link);
            copy.textContent = 'Copied';
        } catch {
            copy.textContent = 'Copy failed';
        }
    });
    const gotIt = el('button', 'bookmark-nudge-button', { type: 'button', text: 'Got it' });
    gotIt.addEventListener('click', hide);
    const off = el('button', 'bookmark-nudge-off', { type: 'button', text: "Don't show again" });
    off.addEventListener('click', () => {
        try { localStorage.setItem(OFF_KEY, '1'); } catch { /* shows on the next map instead */ }
        hide();
    });
    const actions = el('div', 'bookmark-nudge-actions');
    actions.append(off, copy, gotIt);
    const title = el('p', 'bookmark-nudge-title', { html: STAR });
    title.append(el('span', '', { text: `Bookmark this ${what}` }));
    _callout = el('div', 'bookmark-nudge', { id: 'bookmarkNudge', role: 'status' });
    _callout.append(title, el('p', 'bookmark-nudge-text', { text: `${text} ${howTo()}` }), actions);
    document.body.append(_callout);
    place();
};

// Follow a map that has just opened
export const start = (mapId) => {
    hide();
    _mapId = mapId;
};

export const stop = () => {
    hide();
    _mapId = null;
};

const canShow = (key) => !_callout && !!_mapId && _mapId === state.mapId
    && !document.body.classList.contains('welcome-visible') && !tour.isActive()
    && !turnedOff() && !shownFor().includes(key);

// After the title is changed here, once per map, unless the map is open in a project
const noteRenamed = () => {
    if (!dom.boardName.value.trim() || parseLocation(location.pathname).projectId || !canShow(_mapId)) return;
    markShown(_mapId);
    show({ what: 'map', text: 'The link is the only way back to it.', link: location.href.split('#')[0], anchor: dom.boardName });
};

// After a project is started or renamed here, once per project. True when it shows.
const noteProjectNamed = () => {
    const project = projects.current();
    if (!project || dom.projectName.hidden || !canShow(`p:${project.id}`)) return false;
    markShown(`p:${project.id}`);
    show({ what: 'project', text: 'The project link is the only way back to it and its maps.', link: projects.projectLink(), anchor: dom.projectName });
    return true;
};

export const initListeners = () => {
    // change fires when the person leaves the title after editing it, not while they type
    dom.boardName.addEventListener('change', noteRenamed);
    projects.onNamed(noteProjectNamed);
    window.addEventListener('resize', place);
};
