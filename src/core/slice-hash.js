// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Slice links: #slice-<name>-<id>. The name part is only for people reading the link; the
// ID at the end finds the slice, so renaming a slice never breaks a link to it.

const SLICE_HASH = /^#slice-([A-Za-z0-9_-]+)$/;
const MAX_NAME = 20;

// The slice name in lower-case letters and digits joined by hyphens, cut at a whole word to
// MAX_NAME characters. Empty when nothing readable is left, such as for an unnamed slice.
export const sliceSlug = (name) => {
    const words = (name || '')
        .normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
    let slug = '';
    for (const word of words) {
        const next = slug ? `${slug}-${word}` : word;
        if (next.length > MAX_NAME) break;
        slug = next;
    }
    // A first word longer than the limit is cut rather than dropped
    if (!slug && words.length) slug = words[0].slice(0, MAX_NAME);
    return slug;
};

export const sliceHash = (slice) => {
    const slug = sliceSlug(slice.name);
    return `#slice-${slug ? `${slug}-` : ''}${slice.id}`;
};

// The slice a link points at: undefined when the hash isn't a slice link, null when it is but
// no slice matches. Links made before the name part (#slice-<id>) match on the whole ID first;
// otherwise the slice whose ID ends the link wins, the longest ID first, as imported IDs can
// contain hyphens.
export const sliceFromHash = (hash, slices) => {
    const match = (hash || '').match(SLICE_HASH);
    if (!match) return undefined;
    const key = match[1];
    const exact = slices.find(s => s.id === key);
    if (exact) return exact;
    const byEnd = slices
        .filter(s => s.id && key.endsWith(`-${s.id}`))
        .sort((a, b) => b.id.length - a.id.length);
    return byEnd[0] || null;
};
