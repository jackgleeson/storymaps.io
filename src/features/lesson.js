// Storymaps.io — AGPL-3.0 — see LICENCE for details
// A practice story map opened from a docs lesson (?lesson) offers a read-only summary of itself to
// the lesson page around it, which ticks the lesson's tasks as they're done. Only pages on this
// site can read it, since the lesson shows the story map in a frame.

import { entries as logEntries } from '/src/core/log.js';
import { clickEvent } from '/src/features/analytics.js';
import { getYdoc, getProvider, getYmap } from '/src/core/yjs.js';
import { pushUndo, createColumn, createStory } from '/src/core/state.js';
import { CARD_COLORS, DEFAULT_CARD_COLORS } from '/src/core/constants.js';

// Read before the app swaps /new or /sample/<name> for the link of the map. A story map reached
// from inside the practice pane, such as from the home page, is still in the lesson.
const inLessonFrame = () => { try { return window.parent !== window && window.parent.location.pathname.startsWith('/learn/'); } catch { return false; } };
// Only in a browser: the unit tests load this module in Node, with no page
const _lesson = typeof location !== 'undefined' && (new URLSearchParams(location.search).has('lesson') || inLessonFrame());
// A practice story map beside a lesson, which keeps things like the name prompt out of the way
export const isLesson = () => _lesson;
// A lesson can open the story map with ?add=<set> to add a set of cards (docs/card-sets.json)
const _add = _lesson ? new URLSearchParams(location.search).get('add') : null;

// What the learner did beside the lesson that the story map can't show: the buttons analytics
// counts (see analytics.js), and a change made while the story map is open in another window.
// Kept for the tab, so it lasts a trip to the home page and back.
const DID_KEY = 'storymapsLessonDid';
const did = new Set((() => { try { return JSON.parse(sessionStorage.getItem(DID_KEY) || '[]'); } catch { return []; } })());
const note = (name) => {
    if (!name || did.has(name)) return;
    did.add(name);
    try { sessionStorage.setItem(DID_KEY, JSON.stringify([...did])); } catch { /* the tasks still tick while the page is open */ }
};
if (_lesson) document.addEventListener('click', (e) => note(clickEvent(e.target)), true);
const watched = new WeakSet();
const watchTogether = () => {
    const doc = getYdoc();
    if (!doc || watched.has(doc)) return;
    watched.add(doc);
    doc.on('update', () => {
        const states = getProvider()?.awareness?.getStates();
        if (states && states.size > 1) note('changed-in-two-windows');
    });
};

// Beside a lesson, the frame stays on the app: links to the docs, the courses and other site pages
// open in a new tab instead of loading inside the practice pane. The home page stays in the frame,
// as a lesson goes there to open a recent map.
if (_lesson && window.parent !== window) {
    document.addEventListener('click', (e) => {
        const link = e.target.closest && e.target.closest('a[href]');
        if (!link) return;
        const url = new URL(link.href, location.href);
        const leaves = url.origin !== location.origin || /^\/(learn|docs)(\/|$)/.test(url.pathname) || url.pathname.endsWith('.html');
        if (leaves) { link.target = '_blank'; link.rel = 'noopener'; }
    }, true);
}

const names = (cards) => cards.map(card => (card.name || '').trim());

// The story map in plain terms: its name, users, activities and steps in order, each slice with
// its tasks and whether it's complete or closed, the legend, the notes, each partial with how
// many times it's placed, and the activity log, so a CLI lesson can see a push arrive
const summary = (state) => {
    const steps = state.columns.filter(col => !col.partialMapId);
    return {
        name: state.name || '',
        users: names(Object.values(state.users || {}).flat()),
        activities: names(Object.values(state.activities || {}).flat()),
        steps: names(steps),
        slices: state.slices.map(slice => ({
            name: (slice.name || '').trim(),
            goal: slice.goal || '',
            targetDate: slice.targetDate || '',
            closed: slice.collapsed ? (slice.closedReason || 'closed') : '',
            tasks: steps.flatMap(col => (slice.stories[col.id] || []).map(card => ({
                step: (col.name || '').trim(),
                name: (card.name || '').trim(),
                body: card.body || '',
                color: card.color || '',
                tags: card.tags || [],
                status: card.status || null,
                points: card.points ?? null,
            }))),
        })),
        legend: (state.legend || []).map(entry => (entry.label || '').trim()),
        notes: state.notes || '',
        partials: (state.partialMaps || []).map(pm => ({
            name: (pm.name || '').trim(),
            uses: state.columns.filter(col => col.partialMapId === pm.id).length,
        })),
        log: logEntries().map(e => ({ text: e.text || '', src: e.src || '' })),
        did: [...did],
    };
};

// Adds the set as a column at the end, its cards in the first slice, once the story map has
// loaded. Not again if any of its cards is already there, such as after a reload.
const addCardSet = async (state, renderAndSave, name) => {
    let set;
    try { set = (await (await fetch('/learn/card-sets.json')).json())[name]; } catch { return; }
    if (!set) return;
    const loaded = () => state.mapId && getYmap() && state.columns.length && state.slices.length;
    for (let waited = 0; !loaded() && waited < 20000; waited += 250) await new Promise(r => setTimeout(r, 250));
    if (!loaded()) return;
    await new Promise(r => setTimeout(r, 300));
    const norm = (s) => String(s || '').trim().toLowerCase();
    const have = new Set(state.slices.flatMap(sl => Object.values(sl.stories).flat().map(c => norm(c.name))));
    if (!set.cards.some(c => have.has(norm(c)))) {
        pushUndo();
        const column = createColumn(set.step, CARD_COLORS.green);
        state.columns.push(column);
        state.users[column.id] = [];
        state.activities[column.id] = [];
        state.slices.forEach((slice, i) => {
            slice.stories[column.id] = i === 0 ? set.cards.map(c => createStory(c, DEFAULT_CARD_COLORS.story)) : [];
        });
        renderAndSave();
    }
    const url = new URL(location.href);
    url.searchParams.delete('add');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
};

export const init = (state, { renderAndSave } = {}) => {
    if (_lesson) window.storymapsLesson = Object.freeze({ summary: () => { watchTogether(); return summary(state); } });
    if (_add && renderAndSave) addCardSet(state, renderAndSave, _add);
};
