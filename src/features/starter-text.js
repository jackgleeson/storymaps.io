// Storymaps.io — AGPL-3.0 — see LICENCE for details
// A card that still has its starter text, like New Activity on a new map, has the text selected
// when someone clicks or tabs into it, so typing replaces the text rather than adding to it.

import { dom } from '/src/ui/dom.js';
import { STARTER_NAMES } from '/src/core/state.js';

const CARD_TEXT = 'textarea.story-text, textarea.step-text';

const isStarter = (target) => target?.matches?.(CARD_TEXT) && !target.readOnly && STARTER_NAMES.has(target.value);

export const init = () => {
    const map = dom.storyMap;
    if (!map) return;

    // By keyboard, the text is selected as the card gets focus
    map.addEventListener('focusin', (e) => {
        if (isStarter(e.target)) e.target.select();
    });

    // A click puts the text cursor where it lands, after focus, so the click that brings focus
    // selects the text again: straight away, and once more after the click, as Safari puts the
    // cursor down after the click event. Later clicks in the same card place the cursor as usual.
    let focusedAtPress = null;
    map.addEventListener('pointerdown', () => { focusedAtPress = document.activeElement; }, true);
    map.addEventListener('click', (e) => {
        const target = e.target;
        if (target === focusedAtPress || !isStarter(target)) return;
        target.select();
        setTimeout(() => {
            if (document.activeElement === target && isStarter(target)) target.select();
        });
    });
};
