// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Card links (#card-<name>-<id>): copy a link to a card, and open the card a link points at

import { dom } from '/src/ui/dom.js';
import { state } from '/src/core/state.js';
import { showToast } from '/src/core/modals.js';
import { cardHash, cardFromHash, isCardHash } from '/src/core/slice-hash.js';
import { mapLinkUrl, copyLink } from '/src/features/slice-links.js';
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
    // Bring the card into view behind the expanded view, so it's there when that closes
    dom.storyMap.querySelector(`.story-card[data-story-id="${CSS.escape(card.id)}"]`)?.scrollIntoView({ block: 'center', inline: 'center' });
    openExpandModal(card, { readOnly: cards.find(c => c.card === card).readOnly, focus: false });
};

// Closing a card that a link opened takes the card off the URL, so a reload shows the map
export const clearCardHash = () => {
    if (isCardHash(window.location.hash)) history.replaceState(history.state, '', window.location.pathname + window.location.search);
};

export const initListeners = () => {
    document.getElementById('cardExpandCopyLink')?.addEventListener('click', () => {
        const card = getExpandedItem();
        if (card) copyCardLink(card);
    });
};
