// Storymaps.io — AGPL-3.0 — see LICENCE for details
// The guide that follows a tracker import. The cards arrive as one big pile, and the way to
// turn a pile into a story map is to build the backbone first: who it's for, what they're
// trying to do, and the steps they take. Only then do the cards have somewhere to go.
//
// It lights one thing at a time, like the tour, and uses the tour's spotlight to do it. It
// knows nothing about any one tracker: it reads the story map as it is, so it works after an
// import from any of them, by API or by file. To use it, call start() once the imported cards
// are on the story map.

import { state } from '/src/core/state.js';
import * as tour from '/src/features/tour.js';
import { zoomToFit, zoomForTyping } from '/src/ui/navigation.js';

export const IMPORTED_SLICE = 'Imported';
// The page that shows the parts of a story map, for people who arrive from a tracker without the idea
const BACKBONE_DOCS = '/docs/what-is-a-user-story-map';

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

// A big import is fitted to the window, which leaves the cards too small to type on, and the
// story map holds still during a guide. So the backbone is shown big enough to type on, from
// the start of the story map, and the last step fits everything to the window again to show
// the pile.
const show = (zoom) => () => {
    zoom();
    tour.reposition();
};

// The slices the cards move between: the pile, and the release above it
const sliceContainers = () => {
    const pile = state.slices.find(slice => slice.name === IMPORTED_SLICE);
    const containers = [...document.querySelectorAll('.slice-container')];
    const pileEl = pile && document.querySelector(`.story-column[data-slice-id="${pile.id}"]`)?.closest('.slice-container');
    if (!pileEl) return containers.slice(0, 2);
    const above = containers[containers.indexOf(pileEl) - 1];
    return above ? [above, pileEl] : [pileEl];
};

// The steps to show, for a story map that needs these parts
export const guideSteps = (needs) => {
    const count = needs.cards === 1 ? '1 imported card is' : `${needs.cards} imported cards are`;
    const first = `Your ${count} safe in the <strong>${IMPORTED_SLICE}</strong> slice. Before you move any, build the backbone they will hang from. `
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
            title: 'What steps do they take?',
            body: 'Name the green cards from left to right, in the order the user takes them, such as <strong>Browse menu</strong>, <strong>Pay</strong>, <strong>Collect order</strong>. Enter moves to the next one. Leave any spare steps blank.',
            icon: '\u{1F9ED}',
        },
    ].filter(Boolean);
    if (backbone.length) backbone[0] = { ...backbone[0], body: first + backbone[0].body };

    return [...backbone, {
        target: sliceContainers,
        clipRight: '.step:not(.phantom-step)',
        onEnter: show(zoomToFit),
        title: 'Now place the cards',
        body: `${backbone.length ? 'That is the backbone, so every card has somewhere to go. ' : 'The backbone is already here, so every card has somewhere to go. '}`
            + `Drag each card up out of <strong>${IMPORTED_SLICE}</strong> into a release, under the step it belongs to. Select several to move them together.<br><br>When <strong>${IMPORTED_SLICE}</strong> is empty, delete it.`,
        icon: '\u{1F4CB}',
    }];
};

const dialogOpen = () => !!document.querySelector('.modal-overlay.visible');

// Start the guide for the story map that is open. Does nothing when no imported cards are
// waiting, or while the tour or another guide is running. A dialog that opens with the story
// map, such as the one that asks for a name, goes first: the guide waits for it to close.
export const start = () => {
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
