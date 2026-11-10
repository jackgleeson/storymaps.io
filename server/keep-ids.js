// A push replaces the whole map, and the YAML it comes from has no IDs. These match what's pushed
// to what's already in the map, so steps, slices and cards keep their IDs and links to them
// still work. Anything that matches nothing gets a new ID.

import { generateCardId } from './data.js';

// Try each key function in turn, giving each new item the ID of the first unclaimed old item with
// the same key. A key function returns null for an item it can't place. Returns new item -> ID.
const matchIds = (items, oldItems, keys) => {
  const ids = new Map();
  const seen = new Set();
  let free = oldItems.filter(old => old.id && !seen.has(old.id) && seen.add(old.id));
  for (const key of keys) {
    const byKey = new Map();
    for (const old of free) {
      const k = key(old);
      if (k === null) continue;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(old);
    }
    const claimed = new Set();
    for (const item of items) {
      if (ids.has(item)) continue;
      const k = key(item);
      const old = k === null ? undefined : byKey.get(k)?.shift();
      if (old) {
        ids.set(item, old.id);
        claimed.add(old);
      }
    }
    free = free.filter(old => !claimed.has(old));
  }
  return ids;
};

const keyOf = (...parts) => JSON.stringify(parts);

// Steps match by name, or by partial map for a partial's column, then by position, so a renamed
// step keeps its ID. Returns one ID for each step.
export const keepStepIds = (steps, oldSteps) => {
  const describe = (step, at) => ({ id: step.id, name: step.name || '', partialMapId: step.partialMapId, at });
  const items = (steps || []).map(describe);
  const ids = matchIds(items, (oldSteps || []).map(describe), [
    s => s.partialMapId ? keyOf('partial', s.partialMapId) : (s.name ? keyOf('name', s.name) : null),
    s => s.partialMapId ? null : keyOf('at', s.at),
  ]);
  return items.map(item => ids.get(item) || generateCardId());
};

// Slices match by name, then by position, so a renamed slice keeps its ID. Returns one ID for each slice.
export const keepSliceIds = (slices, oldSlices) => {
  const describe = (slice, at) => ({ id: slice.id, name: slice.name || '', at });
  const items = (slices || []).map(describe);
  const ids = matchIds(items, (oldSlices || []).map(describe), [
    s => s.name ? keyOf('name', s.name) : null,
    s => keyOf('at', s.at),
  ]);
  return items.map(item => ids.get(item) || generateCardId());
};

// Groups of cards: { col: column ID, group: slice ID or '', cards: [...] }
const flatten = (groups) => groups.flatMap(({ col, group = '', cards }) => (cards || []).map((card, at) => ({
  id: card.id, name: card.name || '', body: card.body || '', col, group, at,
})));

// Cards match in the same place first, which also keeps repeated names apart. After that, anywhere
// by name and body, then by name alone, so a moved card keeps its ID. Last, by position, so a
// renamed card does too. Returns (col, group, at) -> ID.
export const keepCardIds = (groups, oldGroups) => {
  const items = flatten(groups);
  const ids = matchIds(items, flatten(oldGroups), [
    c => keyOf(c.col, c.group, c.name),
    c => c.name ? keyOf(c.name, c.body) : null,
    c => c.name ? keyOf(c.name) : null,
    c => keyOf(c.col, c.group, c.at),
  ]);
  const byPlace = new Map(items.map(item => [keyOf(item.col, item.group, item.at), ids.get(item)]));
  return (col, group, at) => byPlace.get(keyOf(col, group, at)) || generateCardId();
};

// Cards keyed by column ID, as the map stores users and activities, as groups for keepCardIds
export const groupsByColumn = (cardsByColumn, group = '') =>
  Object.entries(cardsByColumn || {}).map(([col, cards]) => ({ col, group, cards }));
