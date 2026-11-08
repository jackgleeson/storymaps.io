// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Card links (#card-<id>): copy a link to a card, and open the card a link points at

import { dom } from '/src/ui/dom.js';
import { state } from '/src/core/state.js';
import { showToast } from '/src/core/modals.js';
import { cardHash, cardFromHash, isCardHash } from '/src/core/slice-hash.js';
import { mapLinkUrl, copyLink, animateScroll } from '/src/features/slice-links.js';
import { frozenRowsHeight } from '/src/features/freeze-rows.js';
import { openExpandModal, getExpandedItem } from '/src/features/card-expand.js';

// Every card in the map: the user and activity rows, the slices, and the partial maps. Cards in a
// partial map are only edited from the partial map itself, so they open read-only.
const allCards = () => {
    const cards = [];
    const add = (lists, readOnly = false) => Object.values(lists || {}).forEach(list => list.forEach(card => cards.push({ card, readOnly })));
    add(state.users);
    add(state.activities);
    state.slices.forEach(slice => add(slice.stories));
    state.partialMaps.forEach(pm => {
        add(pm.users, true);
        add(pm.activities, true);
        Object.values(pm.stories || {}).forEach(stories => add(stories, true));
    });
    return cards;
};

export const copyCardLink = (card) => copyLink(mapLinkUrl(cardHash(card)), 'Copy this link to the card:');

export const copyCardLinkById = (cardId) => {
    const found = allCards().find(({ card }) => card.id === cardId);
    if (found) copyCardLink(found.card);
};

// Open the card named in the URL fragment, if there is one, in the expanded view
export const openCardFromHash = () => {
    const cards = allCards();
    const card = cardFromHash(window.location.hash, cards.map(c => c.card));
    if (card === undefined) return;
    if (!card) {
        showToast('That card is no longer in this map');
        return;
    }
    if (getExpandedItem()) return;
    openExpandModal(card, { readOnly: cards.find(c => c.card === card).readOnly, focus: false });
};

// Ring the card twice in blue, like a hovered log entry, so it's clear which card the link meant
const flashCard = (cardId) => {
    const el = dom.storyMap.querySelector(`.story-card[data-story-id="${CSS.escape(cardId)}"]`);
    if (!el) return;
    el.classList.remove('card-link-flash');
    void el.offsetWidth; // restart the animation if it's already running
    el.classList.add('card-link-flash');
    el.addEventListener('animationend', () => el.classList.remove('card-link-flash'), { once: true });
};

// Scroll only as far as it takes to show the card, clear of the rows kept in view at the top and
// the controls floating at the bottom, then flash it. A card already on screen stays put, and
// centring would scroll a card near an edge into the empty space around the story map.
const revealCard = (cardId) => {
    const el = dom.storyMap.querySelector(`.story-card[data-story-id="${CSS.escape(cardId)}"]`);
    if (!el) return;
    const wrapper = dom.storyMapWrapper;
    const card = el.getBoundingClientRect();
    const view = wrapper.getBoundingClientRect();
    const padding = 24;
    // The user and activity rows are among the rows kept in view, so nothing covers them
    const topLimit = view.top + padding + (el.dataset.rowType ? 0 : frozenRowsHeight());
    const bottomLimit = view.bottom - 120;
    const leftLimit = view.left + padding;
    const rightLimit = view.right - padding;
    let top = wrapper.scrollTop;
    let left = wrapper.scrollLeft;
    if (card.top < topLimit) top -= topLimit - card.top;
    else if (card.bottom > bottomLimit) top += card.bottom - bottomLimit;
    if (card.left < leftLimit) left -= leftLimit - card.left;
    else if (card.right > rightLimit) left += card.right - rightLimit;
    animateScroll(wrapper, top, left, () => flashCard(cardId));
};

// Closing a card that a link opened takes the card off the URL, so a reload shows the map, and
// shows the card on the story map. Closing re-renders the map, so wait for that first.
export const clearCardHash = () => {
    if (!isCardHash(window.location.hash)) return;
    const card = cardFromHash(window.location.hash, allCards().map(c => c.card));
    history.replaceState(history.state, '', window.location.pathname + window.location.search);
    if (card) requestAnimationFrame(() => revealCard(card.id));
};

export const initListeners = () => {
    document.getElementById('cardExpandCopyLink')?.addEventListener('click', () => {
        const card = getExpandedItem();
        if (card) copyCardLink(card);
    });
};
