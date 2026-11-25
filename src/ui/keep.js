// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Keeping what has not changed when the map is redrawn.
//
// A redraw builds the whole map again from what is in memory. Building, styling and laying out
// every card takes about half a second on a story map of 1,750 cards, and it ran on every change,
// including each letter someone else typed. So a redraw now builds the new map off the page with a
// stand-in for each card or step that has not changed, then brings the page into line with it: kept
// cards stay where they are, and what changed is put in, moved or taken out around them.
//
// These rules keep that safe:
// - A card is kept only if it was drawn from the very same item, for the same place, and the item
//   reads the same as when it was drawn (its fingerprint). Anything else is drawn again. So what a
//   card remembers from when it was built, such as its step and slice, is always right.
// - The elements that hold cards (rows, cells, slices) are matched by a key their builder gives
//   them. Only their class and their children are brought into line, so they must not carry
//   handlers or attributes that depend on what is in memory.
// - A small fixed part, such as the add button of a cell or an empty placeholder, can be named as
//   a leaf. A leaf on the page stays when the new build has a leaf of the same name in the same
//   holder, so its name must say everything that decides how it is built. Replacing these on
//   every redraw made the browser lay every cell out again.
// - Everything else, such as slice headings, has no key and is put in new on every redraw.
//
// The browser tests check every redraw against the map built from nothing (see redraw-check.js).

// The cards and steps on the page, by kind and ID, while a keeping redraw builds. Null otherwise,
// and then the builders draw everything.
let _onPage = null;

export const startKeeping = (map) => {
    _onPage = new Map();
    for (const card of map.querySelectorAll('.story-card, .step')) {
        if (card._item) _onPage.set(`${card._kind}:${card._item.id}`, card);
    }
};

export const stopKeeping = () => { _onPage = null; };

const fingerprint = (item, place) => `${place}|${JSON.stringify(item)}`;

// The stand-in for a card that can stay as it is, or null when it has to be drawn
export const standIn = (kind, item, place) => {
    const card = _onPage?.get(`${kind}:${item.id}`);
    if (!card || card._unsettled || card._item !== item || card._print !== fingerprint(item, place)) return null;
    // Two items with one ID can't both keep the same card
    _onPage.delete(`${kind}:${item.id}`);
    const mark = document.createComment('kept');
    mark._keep = card;
    return mark;
};

// Note what a card was drawn from, so a later redraw can tell whether it still holds
export const signed = (card, kind, item, place) => {
    card._kind = kind;
    card._item = item;
    card._place = place;
    card._print = fingerprint(item, place);
    return card;
};

// For a change made to a card where it stands (typing, a new colour): the card now shows the item
// as it is, so it can be kept
export const resign = (card) => {
    if (card?._item) card._print = fingerprint(card._item, card._place);
};

// Some parts of a card are sized by measuring it on the page, such as the rows of its title. A card
// that could not be measured, because the map was not showing at the time, is drawn again by the
// next redraw and measured then. Pass any element inside the card.
export const unsettle = (el) => {
    const card = el.closest('.story-card, .step');
    if (card) card._unsettled = true;
};

// Give an element that holds cards its key (see the rules above)
export const keyed = (el, key) => {
    el._key = key;
    return el;
};

// Name a small fixed part as a leaf (see the rules above)
export const leaf = (el, name) => {
    el._leaf = name;
    return el;
};

// Bring the class and children of an element on the page into line with a freshly built one
export const sync = (live, fresh) => {
    if (live.className !== fresh.className) live.className = fresh.className;

    const liveByKey = new Map(), liveLeaves = new Map();
    for (const child of live.children) {
        if (child._key) liveByKey.set(child._key, child);
        else if (child._leaf) liveLeaves.set(child._leaf, child);
    }

    // What should be here, in order: kept cards and leaves, matched holders, and everything else new
    const wanted = [...fresh.childNodes].map(node => {
        if (node._keep) return node._keep;
        if (node._leaf) {
            const same = liveLeaves.get(node._leaf);
            if (!same || same.tagName !== node.tagName) return node;
            liveLeaves.delete(node._leaf);
            return same;
        }
        const match = node._key && liveByKey.get(node._key);
        if (!match || match.tagName !== node.tagName) return node;
        liveByKey.delete(node._key);
        sync(match, node);
        return match;
    });

    const staying = new Set(wanted);
    for (const child of [...live.childNodes]) if (!staying.has(child)) child.remove();
    let at = live.firstChild;
    for (const node of wanted) {
        if (node === at) at = at.nextSibling;
        else live.insertBefore(node, at);
    }
};
