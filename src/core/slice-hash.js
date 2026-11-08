// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Slice links: #slice-<name>-<id>. The name part is only for people reading the link; the ID
// at the end finds the slice, so renaming a slice never breaks a link to it. Card links are
// #card-<id>.

const MAX_NAME = 20;

// A name in lower-case letters and digits joined by hyphens. Empty when nothing readable is
// left, such as for an unnamed slice.
const slugWords = (name) => (name || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

// The slice name as a slug, cut at a whole word to MAX_NAME characters
export const sliceSlug = (name) => {
    const words = slugWords(name);
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

const linkHash = (kind, slug, id) => `#${kind}-${slug ? `${slug}-` : ''}${id}`;

// The item a link points at: undefined when the hash isn't a link of this kind, null when it is
// but no item matches. Links made before the name part (#slice-<id>) match on the whole ID first;
// otherwise the item whose ID ends the link wins, the longest ID first, as imported IDs can
// contain hyphens.
const fromLinkHash = (kind, hash, items) => {
    const match = (hash || '').match(new RegExp(`^#${kind}-([A-Za-z0-9_-]+)$`));
    if (!match) return undefined;
    const key = match[1];
    const exact = items.find(s => s.id === key);
    if (exact) return exact;
    const byEnd = items
        .filter(s => s.id && key.endsWith(`-${s.id}`))
        .sort((a, b) => b.id.length - a.id.length);
    return byEnd[0] || null;
};

export const sliceHash = (slice) => linkHash('slice', sliceSlug(slice.name), slice.id);
export const sliceFromHash = (hash, slices) => fromLinkHash('slice', hash, slices);

// Card links carry just the ID, so every card link looks the same however long the title
export const cardHash = (card) => linkHash('card', '', card.id);
export const cardFromHash = (hash, cards) => fromLinkHash('card', hash, cards);
export const isCardHash = (hash) => /^#card-[A-Za-z0-9_-]+$/.test(hash || '');
