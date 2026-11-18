// Storymaps.io — AGPL-3.0 — see LICENCE for details
// The guide that follows a tracker import. The cards arrive as one big pile, and the way to
// turn a pile into a story map is to build the backbone first: who it's for, what they're
// trying to do, and the steps they take. Only then do the cards have somewhere to go.
//
// It lights one thing at a time, like the tour, and uses the tour's spotlight to do it. It
// knows nothing about any one tracker: it reads the story map as it is, so it works after an
// import from any of them, by API or by file. To use it, call start() once the imported cards
// are on the story map.

import { state, createColumn, pushUndo } from '/src/core/state.js';
import { CARD_COLORS } from '/src/core/constants.js';
import * as tour from '/src/features/tour.js';
import { zoomToFit, zoomForTyping } from '/src/ui/navigation.js';

export const IMPORTED_SLICE = 'Imported';
// The guide to the backbone, for people who arrive from a tracker without the idea
const BACKBONE_DOCS = '/docs/define-the-story-map-backbone';
const DELETE_SLICE_DOCS = '/docs/plan-releases-with-story-map-slices#delete-a-slice';

// What the story map already has. A part of the backbone that is named needs no step.
export const backboneNeeds = (map) => {
    const named = (cards) => (cards || []).some(card => (card.name || '').trim());
    const steps = map.columns.filter(column => !column.hidden && !column.partialMapId);
    const pile = map.slices.find(slice => slice.name === IMPORTED_SLICE);
    return {
        user: !Object.values(map.users).some(named),
        activity: !Object.values(map.activities).some(named),
        steps: steps.length > 0 && !steps.some(column => (column.name || '').trim()),
        cards: pile ? Object.values(pile.stories).reduce((n, cards) => n + cards.filter(card => (card.name || '').trim()).length, 0) : 0,
    };
};

const STEP_FIELDS = '.steps-row .step:not(.phantom-step) .step-text';
let _renderAndSave = null;   // redraws and saves the story map after the guide changes it

// A big import is fitted to the window, which leaves the cards too small to type on. So the
// backbone is shown big enough to type on, from the start of the story map, and the last step
// fits everything to the window again to show the pile. The zoom buttons stay in reach
// throughout, for anyone who wants it bigger or smaller.
const show = (zoom) => () => {
    zoom();
    tour.reposition();
};

const isStep = (column) => !column.hidden && !column.partialMapId;
const hasName = (item) => !!(item.name || '').trim();

// Add a blank step at the end of the backbone, so the journey can be as long as it needs to be
export const addStep = (map) => {
    const column = createColumn('', CARD_COLORS.green);
    map.columns.push(column);
    map.users[column.id] = [];
    map.activities[column.id] = [];
    map.slices.forEach(slice => { slice.stories[column.id] = []; });
    return column;
};

// Make the backbone exactly the steps that were named. The import makes a column for every pile
// of cards, so there are usually spare ones. The unnamed steps go, and the pile is dealt again
// under the named ones, in the same order: where a card sits in the pile means nothing yet.
// Anything else under an unnamed step moves to the first named one, so nothing is lost.
// With no step named, or none spare, nothing changes. Returns whether anything did.
export const fitBackbone = (map) => {
    const steps = map.columns.filter(isStep);
    const named = steps.filter(hasName);
    const spare = steps.filter(step => !hasName(step));
    if (!named.length || !spare.length) return false;
    const first = named[0];

    // The pile, read as it was dealt: along each row from the left, then the next row down
    const pile = map.slices.find(slice => slice.name === IMPORTED_SLICE);
    if (pile) {
        const cells = steps.map(step => pile.stories[step.id] || []);
        const rows = Math.max(0, ...cells.map(cell => cell.length));
        const cards = [];
        for (let row = 0; row < rows; row++) cells.forEach(cell => { if (cell[row]) cards.push(cell[row]); });
        steps.forEach(step => { pile.stories[step.id] = []; });
        cards.forEach((card, i) => pile.stories[named[i % named.length].id].push(card));
    }

    spare.forEach(step => {
        // A user or an activity that was named under a spare step keeps its place at the start
        [map.users, map.activities].forEach(row => {
            (row[step.id] || []).filter(hasName).forEach(card => row[first.id].push(card));
            delete row[step.id];
        });
        map.slices.forEach(slice => {
            (slice.stories[step.id] || []).filter(hasName).forEach(card => slice.stories[first.id].push(card));
            delete slice.stories[step.id];
        });
    });
    map.columns = map.columns.filter(column => !spare.includes(column));
    return true;
};

// The steps to show, for a story map that needs these parts
export const guideSteps = (needs) => {
    const count = needs.cards === 1 ? '1 imported card is' : `${needs.cards} imported cards are`;
    const first = `Your ${count} safe in the <strong>${IMPORTED_SLICE}</strong> slice. Before you move any, build the backbone: who it's for, what they're trying to do and the steps they take. `
        + `If you don't know what a backbone is, <a href="${BACKBONE_DOCS}" target="_blank" rel="noopener">catch up here</a>.<br><br>`;
    const backbone = [
        needs.user && {
            target: '.users-row .story-card',
            focus: '.users-row .story-card .story-text',
            onEnter: show(zoomForTyping),
            title: 'Who is it for?',
            body: 'Type a name on the red card, such as <strong>Customer</strong>.',
            icon: '\u{1F464}',
        },
        needs.activity && {
            target: '.activities-row .story-card',
            focus: '.activities-row .story-card .story-text',
            onEnter: show(zoomForTyping),
            title: 'What are they trying to do?',
            body: 'Type it on the blue card, such as <strong>Order a coffee</strong>.',
            icon: '\u{1F3AF}',
        },
        needs.steps && {
            target: '.steps-row',
            clipRight: '.step:not(.phantom-step)',
            focus: STEP_FIELDS,
            fields: STEP_FIELDS,
            onEnter: show(zoomForTyping),
            // Enter on the last step adds another; moving on keeps only the steps that were named
            addField: () => {
                addStep(state);
                _renderAndSave?.();
            },
            onLeave: () => {
                const steps = state.columns.filter(isStep);
                if (!steps.some(hasName) || steps.every(hasName)) return;
                pushUndo();
                fitBackbone(state);
                _renderAndSave?.();
            },
            title: 'What steps do they take?',
            body: 'Name the green cards from left to right, in the order the user takes them, such as <strong>Browse menu</strong>, <strong>Pay</strong>, <strong>Collect order</strong>. Enter moves to the next one, and adds another after the last. Steps you leave blank are taken away when you move on.',
            icon: '\u{1F9ED}',
        },
    ].filter(Boolean);
    if (backbone.length) backbone[0] = { ...backbone[0], body: first + backbone[0].body };

    // The last step dims nothing: this is where the work starts, so cards can be dragged, opened and selected
    return [...backbone, {
        free: true,
        onEnter: show(zoomToFit),
        title: 'Now place the cards',
        body: `${backbone.length ? 'That is the backbone, so every card has somewhere to go. ' : 'The backbone is already here, so every card has somewhere to go. '}`
            + `Drag each card up out of <strong>${IMPORTED_SLICE}</strong> into a release, under the step it belongs to. Select several to move them together.<br><br>When the <strong>${IMPORTED_SLICE}</strong> slice is empty, <a href="${DELETE_SLICE_DOCS}" target="_blank" rel="noopener">delete it</a>.`,
        icon: '\u{1F4CB}',
    }];
};

const dialogOpen = () => !!document.querySelector('.modal-overlay.visible');

// Start the guide for the story map that is open. Does nothing when no imported cards are
// waiting, or while the tour or another guide is running. A dialog that opens with the story
// map, such as the one that asks for a name, goes first: the guide waits for it to close.
export const start = ({ renderAndSave } = {}) => {
    _renderAndSave = renderAndSave || null;
    const mapId = state.mapId;
    if (!backboneNeeds(state).cards || tour.isActive()) return;
    let tries = 0;
    const begin = () => {
        if (state.mapId !== mapId || tour.isActive()) return;
        if (dialogOpen()) {
            if (++tries < 240) setTimeout(begin, 500);   // up to two minutes
            return;
        }
        // Read the story map again: it may have changed while a dialog was open
        const needs = backboneNeeds(state);
        if (needs.cards) tour.runSteps(guideSteps(needs), { typing: true, placement: 'right', skipLabel: 'Skip the guide', finishLabel: 'Got it' });
    };
    // The import has only just been drawn and fitted to the window; let that settle first
    setTimeout(begin, 400);
};
