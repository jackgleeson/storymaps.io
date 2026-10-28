// Storymaps.io — AGPL-3.0 — see LICENCE for details
// The map is built in two zoomed parts: the top rows (users, activities, steps) and the slices
// below them. The map element itself isn't zoomed, so the top rows can stay in view with
// position: sticky, which drifts inside zoomed content. Both parts take the same zoom from --zoom,
// and the top part reserves its zoomed height, so map positions divided by the zoom still match
// map content, as they did when the whole map was zoomed.

export const mapTop = (map) => map.querySelector(':scope > .map-top');
export const mapBody = (map) => map.querySelector(':scope > .map-body');

// Reserve the zoomed height of the top rows, so the slices sit straight below them
export const fitMapTop = (map) => {
    const top = mapTop(map);
    if (top) top.style.height = `${top.firstElementChild.getBoundingClientRect().height}px`;
};
