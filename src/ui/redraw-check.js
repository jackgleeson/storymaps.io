// Storymaps.io — AGPL-3.0 — see LICENCE for details
// A check for the browser tests. A redraw keeps the cards, cells and slices that have not changed
// and replaces the rest, so the risk is a part that was kept when it should have been drawn again.
// With window.__redrawCheck set, every redraw is followed by building the whole map again off the
// page, and the two are compared. A difference is logged, and the test fixtures fail on the log.

// Classes that are not part of how the map is built: the pointer, a menu or a drag leaves them, or
// another feature places them after a redraw and takes them away itself. A class missing from here
// that turns up on the page is reported, so a new one has to be thought about.
const NOT_BUILT = new Set([
    // Pointer, menus, typing
    'card-hovered', 'menu-open', 'tags-hover', 'tags-open', 'below', 'flip-left', 'limit-hit', 'visible',
    'slice-name-dimmed',
    // Dragging
    'column-being-dragged', 'multi-drag-following',
    // Selection, search, the log, undo and links
    'card-selected', 'column-selected', 'marquee-preview', 'search-dimmed', 'log-highlight', 'log-locatable',
    'undo-highlight', 'card-link-flash', 'slice-spotlight-target', 'slice-spotlight-land',
]);
const built = (cls) => !NOT_BUILT.has(cls) && !cls.startsWith('sortable-');

// Parts filled in after the build: a card menu when it first opens, and the invisible tags button
// a card gets on the next frame when a tag is too long to show whole
const skipChildren = (el) => el.classList.contains('options-menu');
const skip = (el) => el.classList.contains('card-tags-anchor');

// Inline styles set after the build: the height of the top part, an open tags popover, the pointer
// over tags that open one
const skipStyle = (el) => el.matches('.map-top, .card-tags-popover, .card-tag-badge');

const describe = (node, depth, lines) => {
    const pad = '  '.repeat(depth);
    if (node.nodeType === Node.TEXT_NODE) {
        if (node.data.trim()) lines.push(`${pad}${JSON.stringify(node.data)}`);
        return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || skip(node)) return;
    const classes = [...node.classList].filter(built).sort().join('.');
    const attrs = [...node.attributes]
        // The rows of a title are measured on the page, Sortable marks what it can drag, and a
        // kept card can have its menu open
        .filter(a => !['class', 'style', 'rows', 'draggable', 'aria-expanded'].includes(a.name))
        .map(a => `${a.name}=${JSON.stringify(a.value)}`).sort();
    // Sortable slides cards into place with a transform and a transition of its own, and takes
    // them off when the slide ends. A kept card can still be mid-slide when the map is redrawn.
    const style = skipStyle(node) ? '' : [...node.style]
        .filter(prop => prop !== 'transform' && !prop.startsWith('transition'))
        .map(prop => `${prop}: ${node.style.getPropertyValue(prop)};`).join(' ');
    if (style) attrs.push(`style=${JSON.stringify(style)}`);
    if (node.tagName === 'TEXTAREA' || node.tagName === 'INPUT') attrs.push(`value=${JSON.stringify(node.value)}`);
    lines.push(`${pad}${node.tagName.toLowerCase()}${classes ? '.' + classes : ''}${attrs.length ? ' ' + attrs.join(' ') : ''}`);
    if (skipChildren(node)) return;
    for (const child of node.childNodes) describe(child, depth + 1, lines);
};

// Null when the map on the page matches the one built from nothing, or a few lines saying where
// they first differ
export const compareMaps = (page, fresh) => {
    const a = [], b = [];
    for (const child of page.childNodes) describe(child, 0, a);
    for (const child of fresh.childNodes) describe(child, 0, b);
    const at = a.findIndex((line, i) => line !== b[i]);
    if (at === -1 && a.length === b.length) return null;
    const i = at === -1 ? a.length : at;
    // The lines above with less indent say where in the map this is
    const where = [];
    let indent = (a[i] ?? b[i] ?? '').search(/\S/);
    for (let k = i - 1; k >= 0 && indent > 0; k--) {
        const depth = a[k].search(/\S/);
        if (depth < indent) { where.unshift(a[k].trim().slice(0, 90)); indent = depth; }
    }
    return [
        `the page and the map built from nothing differ at line ${i + 1} of ${a.length} and ${b.length}`,
        `  in: ${where.join(' > ')}`,
        `  page:  ${(a[i] ?? '(nothing)').trim()}`,
        `  built: ${(b[i] ?? '(nothing)').trim()}`,
    ].join('\n');
};
