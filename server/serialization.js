import { createHash } from 'node:crypto';
import { generateCardId } from './data.js';
import { keepStepIds, keepSliceIds, keepCardIds, groupsByColumn } from './keep-ids.js';
import { copySliceDetails, normalizePoints } from '../src/core/constants.js';

export const serializeDoc = (doc) => {
  const ymap = doc.getMap('storymap');
  const columns = ymap.get('columns')?.toJSON() || [];
  const usersMap = ymap.get('users')?.toJSON() || {};
  const activitiesMap = ymap.get('activities')?.toJSON() || {};
  const slicesArr = ymap.get('slices')?.toJSON() || [];
  const legendArr = ymap.get('legend')?.toJSON() || [];
  const notes = doc.getText('notes')?.toString() || '';

  const sCard = (c) => {
    const o = { name: c.name || '' };
    if (c.body) o.body = c.body;
    if (c.color) o.color = c.color;
    if (c.url) o.url = c.url;
    if (c.hidden) o.hidden = true;
    if (c.status) o.status = c.status;
    if (c.points != null) o.points = c.points;
    const tags = c.tags ? (typeof c.tags === 'string' ? JSON.parse(c.tags) : c.tags) : [];
    if (tags.length) o.tags = tags;
    return o;
  };

  const toPositional = (map) => columns.map(col => (map[col.id] || []).map(sCard));

  const result = {
    app: 'storymap', v: 1,
    exported: new Date().toISOString(),
    name: ymap.get('name') || '',
    users: toPositional(usersMap),
    activities: toPositional(activitiesMap),
    steps: columns.map(col => {
      if (col.partialMapId) {
        const o = { partialMapId: col.partialMapId };
        if (col.partialMapOrigin) o.partialMapOrigin = true;
        return o;
      }
      return sCard(col);
    }),
    slices: slicesArr.map(s => {
      const stories = s.stories || {};
      const obj = { name: s.name || '', stories: columns.map(col => (stories[col.id] || []).map(sCard)) };
      if (s.collapsed) obj.collapsed = true;
      if (s.closedReason) obj.closedReason = s.closedReason;
      copySliceDetails(s, obj);
      return obj;
    }),
  };

  if (legendArr.length) result.legend = legendArr.map(e => ({ color: e.color, label: e.label }));
  if (notes) result.notes = notes;

  // Partial maps: stored in state format (keyed by IDs), convert to serialized format (positional arrays)
  const pmRaw = ymap.get('partialMaps');
  if (pmRaw) {
    const pms = typeof pmRaw === 'string' ? JSON.parse(pmRaw) : pmRaw;
    if (pms?.length) {
      result.partialMaps = pms.map(pm => {
        const pmCols = pm.columns || [];
        return {
          id: pm.id,
          name: pm.name,
          users: pmCols.map(c => (pm.users?.[c.id] || []).map(sCard)),
          activities: pmCols.map(c => (pm.activities?.[c.id] || []).map(sCard)),
          steps: pmCols.map(sCard),
          stories: slicesArr.map(slice =>
            pmCols.map(c => (pm.stories?.[slice.id]?.[c.id] || []).map(sCard))
          )
        };
      });
    }
  }

  return result;
};

// Compute ETag from content fields only (excludes volatile metadata like exported, locked)
// The site a map says it's on: the host without its port, except on a local server
export const siteOf = (host) => {
  const value = host || '';
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(value) ? value.replace(/:3000$/, '') : value.replace(/:\d+$/, '');
};

export const contentEtag = (data) => {
  const { app, v, exported, id, site, locked, backups, ...content } = data;
  return `"${createHash('md5').update(JSON.stringify(content, null, 2)).digest('hex')}"`;
};

export const loadAndSerialize = async (mapId, host, { Y, docs, getPersistence, readJson, LOCK_FILE, getBackupFile }) => {
  // Try in-memory first (active WebSocket connections)
  let doc = docs.get(mapId);
  let data;
  if (doc) {
    data = serializeDoc(doc);
  } else {
    // Load from LevelDB persistence
    const persistence = getPersistence();
    if (!persistence) return null;
    // getYDoc only reads, where bindState would store an empty entry for a map that isn't there
    doc = await persistence.provider.getYDoc(mapId);
    const ymap = doc.getMap('storymap');
    if (!ymap.get('columns')) { doc.destroy(); return null; }
    data = serializeDoc(doc);
    doc.destroy();
  }
  if (data) {
    // Insert name, id, locked for readable key ordering
    const { app, v, exported, name, ...rest } = data;
    const locks = await readJson(LOCK_FILE, {});
    // A local server keeps its port, so the CLI can find a server that isn't on port 3000
    const site = siteOf(host);
    data = { app, v, exported, name, id: mapId, site, locked: !!locks[mapId]?.isLocked, ...rest };
    // Include backups for the routes that need them; links like /<map>.yaml and the CLI API leave them out
    const backups = await readJson(getBackupFile(mapId), []);
    if (backups.length) data.backups = backups;
  }
  return data;
};

/** Append a log entry to a Yjs doc's log Y.Array. */
export const appendLogEntry = (doc, text, ids = []) => {
  const yarray = doc.getArray('log');
  const entry = { ts: Date.now(), src: 'cli', text, sid: '', ids };
  doc.transact(() => {
    yarray.push([entry]);
    while (yarray.length > 20) yarray.delete(0);
  }, 'local');
};

/**
 * Diff a CLI push: snapshot before write, call again after write to collect changed IDs.
 * Returns { text, ids } or null if nothing changed.
 */
export const diffPush = (oldSnapshot, body, newDoc) => {
  const old = oldSnapshot;
  const flat = (arr) => Array.isArray(arr) ? arr.flat().length : 0;
  const oldSteps = old.steps?.filter(s => !s.partialMapId).length || 0;
  const newSteps = (body.steps || []).filter(s => !s.partialMapId).length;
  const oldSlices = old.slices?.length || 0;
  const newSlices = (body.slices || []).length;
  const oldCards = flat(old.users) + flat(old.activities)
    + (old.slices || []).reduce((n, s) => n + flat(s.stories), 0);
  const newCards = flat(body.users) + flat(body.activities)
    + (body.slices || []).reduce((n, s) => n + flat(s.stories), 0);

  const parts = [];
  const ids = [];
  const diff = (label, o, n) => {
    if (n > o) { const d = n - o; parts.push(`added ${d} ${d === 1 ? label.replace(/s$/, '') : label}`); }
    else if (n < o) { const d = o - n; parts.push(`removed ${d} ${d === 1 ? label.replace(/s$/, '') : label}`); }
  };
  const countRenames = (oldSlices, newSlices) => {
    let renamed = 0;
    (newSlices || []).forEach((ns, i) => {
      const os = oldSlices?.[i];
      if (!os) return;
      const oldNames = (os.stories || []).flat().map(c => c?.name ?? '');
      const newNames = (ns.stories || []).flat().map(c => c?.name ?? '');
      if (oldNames.length !== newNames.length) return;
      const oc = new Map(), nc = new Map();
      oldNames.forEach(n => oc.set(n, (oc.get(n) || 0) + 1));
      newNames.forEach(n => nc.set(n, (nc.get(n) || 0) + 1));
      new Set([...oc.keys(), ...nc.keys()]).forEach(n => {
        const d = (nc.get(n) || 0) - (oc.get(n) || 0);
        if (d > 0) renamed += d;
      });
    });
    return renamed;
  };
  if (old.name !== (body.name || '')) parts.push('renamed map');
  const counted = parts.length;
  diff('steps', oldSteps, newSteps);
  diff('slices', oldSlices, newSlices);
  diff('cards', oldCards, newCards);

  // Detect per-item content edits and collect new Yjs IDs of changed items. Only when nothing was
  // added or removed, as positions no longer line up then. A map rename doesn't stop it, so a push
  // that renames the map and edits a card says both, matching the cards its entry highlights.
  if (parts.length === counted) {
    const j = (v) => JSON.stringify(v ?? []);
    if (j(old.steps) !== j(body.steps)) parts.push('edited steps');
    if (j(old.users) !== j(body.users)) parts.push('edited user cards');
    if (j(old.activities) !== j(body.activities)) parts.push('edited activity cards');
    if (j(old.slices) !== j(body.slices)) {
      const renamed = countRenames(old.slices, body.slices);
      parts.push(renamed > 0
        ? `renamed ${renamed} ${renamed === 1 ? 'card' : 'cards'}`
        : 'edited slices');
    }
    if (j(old.legend) !== j(body.legend)) parts.push('edited legend');
    // No notes key leaves the notes as they were (see writeDocFromJson)
    if (typeof body.notes === 'string' && (old.notes || '') !== body.notes) parts.push('edited notes');
  }
  if (!parts.length) return null;

  // Collect IDs of changed cards/steps from the new doc
  const ymap = newDoc.getMap('storymap');
  const columns = ymap.get('columns')?.toJSON() || [];

  // Diff steps
  (body.steps || []).forEach((step, i) => {
    if (i < (old.steps || []).length && JSON.stringify(old.steps[i]) !== JSON.stringify(step)) {
      if (columns[i]?.id) ids.push(columns[i].id);
    }
  });

  // Diff card rows (users, activities) by position
  const diffCards = (oldRow, newRow, yMapKey) => {
    const yRow = ymap.get(yMapKey)?.toJSON() || {};
    (newRow || []).forEach((cards, colIdx) => {
      const oldCards = oldRow?.[colIdx] || [];
      const colId = columns[colIdx]?.id;
      if (!colId) return;
      const yCards = yRow[colId] || [];
      (cards || []).forEach((card, cardIdx) => {
        if (JSON.stringify(oldCards[cardIdx]) !== JSON.stringify(card)) {
          if (yCards[cardIdx]?.id) ids.push(yCards[cardIdx].id);
        }
      });
    });
  };
  diffCards(old.users, body.users, 'users');
  diffCards(old.activities, body.activities, 'activities');

  // Diff slice story cards
  (body.slices || []).forEach((slice, si) => {
    const oldSlice = old.slices?.[si];
    const ySlices = ymap.get('slices')?.toJSON() || [];
    const ySlice = ySlices[si];
    (slice.stories || []).forEach((cards, colIdx) => {
      const oldCards = oldSlice?.stories?.[colIdx] || [];
      const colId = columns[colIdx]?.id;
      if (!colId) return;
      const yCards = ySlice?.stories?.[colId] || [];
      (cards || []).forEach((card, cardIdx) => {
        if (JSON.stringify(oldCards[cardIdx]) !== JSON.stringify(card)) {
          if (yCards[cardIdx]?.id) ids.push(yCards[cardIdx].id);
        }
      });
    });
  });

  return { text: parts.join(', ').replace(/^./, c => c.toUpperCase()), ids };
};

const parsePartialMaps = (raw) => {
  const maps = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return Array.isArray(maps) ? maps : [];
};

export const writeDocFromJson = (doc, data, Y) => {
  doc.transact(() => {
    const ymap = doc.getMap('storymap');
    // What the map holds now, read before anything is replaced, so what's pushed can keep its IDs
    const before = {
      columns: ymap.get('columns')?.toJSON() || [],
      users: ymap.get('users')?.toJSON() || {},
      activities: ymap.get('activities')?.toJSON() || {},
      slices: ymap.get('slices')?.toJSON() || [],
      partialMaps: parsePartialMaps(ymap.get('partialMaps')),
    };
    ymap.set('name', data.name || '');

    // Columns
    const columnIds = keepStepIds(data.steps, before.columns);
    const columns = (data.steps || []).map((step, stepIndex) => {
      const id = columnIds[stepIndex];
      if (step.partialMapId) {
        const col = { id, partialMapId: step.partialMapId };
        if (step.partialMapOrigin) col.partialMapOrigin = true;
        return col;
      }
      return {
        id, name: step.name || '', color: step.color || '', hidden: step.hidden || false,
        body: step.body || '', url: step.url || null, status: step.status || null,
        points: normalizePoints(step.points), tags: step.tags || [],
      };
    });

    const yColumns = new Y.Array();
    columns.forEach(col => {
      const yCol = new Y.Map();
      yCol.set('id', col.id);
      if (col.partialMapId) {
        yCol.set('partialMapId', col.partialMapId);
        if (col.partialMapOrigin) yCol.set('partialMapOrigin', true);
      } else {
        yCol.set('name', col.name);
        if (col.color) yCol.set('color', col.color);
        if (col.hidden) yCol.set('hidden', true);
        if (col.body) yCol.set('body', col.body);
        if (col.url) yCol.set('url', col.url);
        if (col.status) yCol.set('status', col.status);
        if (col.points != null) yCol.set('points', col.points);
        if (col.tags?.length) yCol.set('tags', JSON.stringify(col.tags));
      }
      yColumns.push([yCol]);
    });
    ymap.set('columns', yColumns);

    // Helper: create a Y.Map card from a plain object
    const makeYCard = (card, id) => {
      const ym = new Y.Map();
      ym.set('id', id);
      ym.set('name', card.name || '');
      if (card.body) ym.set('body', card.body);
      if (card.color) ym.set('color', card.color);
      if (card.url) ym.set('url', card.url);
      if (card.hidden) ym.set('hidden', true);
      if (card.status) ym.set('status', card.status);
      const points = normalizePoints(card.points);
      if (points != null) ym.set('points', points);
      if (card.tags?.length) ym.set('tags', JSON.stringify(card.tags));
      return ym;
    };

    // Positional rows of cards as groups for keepCardIds, one group per column that exists
    const rowGroups = (rows, ids, group = '') => (rows || []).slice(0, ids.length).map((cards, i) => ({ col: ids[i], group, cards }));

    // Users (positional array -> keyed by column ID)
    const userId = keepCardIds(rowGroups(data.users, columnIds), groupsByColumn(before.users));
    const yUsers = new Y.Map();
    (data.users || []).forEach((cards, i) => {
      if (i >= columns.length) return;
      const yArr = new Y.Array();
      (cards || []).forEach((card, at) => yArr.push([makeYCard(card, userId(columns[i].id, '', at))]));
      yUsers.set(columns[i].id, yArr);
    });
    ymap.set('users', yUsers);

    // Activities
    const activityId = keepCardIds(rowGroups(data.activities, columnIds), groupsByColumn(before.activities));
    const yActivities = new Y.Map();
    (data.activities || []).forEach((cards, i) => {
      if (i >= columns.length) return;
      const yArr = new Y.Array();
      (cards || []).forEach((card, at) => yArr.push([makeYCard(card, activityId(columns[i].id, '', at))]));
      yActivities.set(columns[i].id, yArr);
    });
    ymap.set('activities', yActivities);

    // Slices (the IDs also key the stories of partial maps)
    const sliceIds = keepSliceIds(data.slices, before.slices);
    // One pool for every slice, so a card moved to another slice keeps its ID
    const storyId = keepCardIds(
      (data.slices || []).flatMap((slice, si) => rowGroups(slice.stories, columnIds, sliceIds[si])),
      before.slices.flatMap(slice => groupsByColumn(slice.stories, slice.id)),
    );
    const ySlices = new Y.Array();
    (data.slices || []).forEach((slice, sliceIndex) => {
      const ySlice = new Y.Map();
      const sliceId = sliceIds[sliceIndex];
      ySlice.set('id', sliceId);
      ySlice.set('name', slice.name || '');
      if (slice.collapsed) ySlice.set('collapsed', true);
      if (slice.closedReason) ySlice.set('closedReason', slice.closedReason);
      for (const [key, value] of Object.entries(copySliceDetails(slice, {}))) ySlice.set(key, value);

      const yStories = new Y.Map();
      (slice.stories || []).forEach((cards, i) => {
        if (i >= columns.length) return;
        const yArr = new Y.Array();
        (cards || []).forEach((card, at) => yArr.push([makeYCard(card, storyId(columns[i].id, sliceId, at))]));
        yStories.set(columns[i].id, yArr);
      });
      ySlice.set('stories', yStories);
      ySlices.push([ySlice]);
    });
    ymap.set('slices', ySlices);

    // Legend
    const yLegend = new Y.Array();
    (data.legend || []).forEach(entry => {
      const ym = new Y.Map();
      ym.set('id', generateCardId());
      ym.set('color', entry.color);
      ym.set('label', entry.label || '');
      yLegend.push([ym]);
    });
    ymap.set('legend', yLegend);

    // Notes are mostly written in the browser, so a map without a notes key leaves them alone.
    // Empty notes ("") clear them.
    const ytext = doc.getText('notes');
    if (typeof data.notes === 'string' && ytext.toString() !== data.notes) {
      if (ytext.length > 0) ytext.delete(0, ytext.length);
      if (data.notes) ytext.insert(0, data.notes);
    }

    // Partial maps: convert from serialized format (positional arrays, `steps` key)
    // to state format (keyed by IDs, `columns` key) so the client can use them directly.
    // A map without partial maps stores an empty list rather than deleting the key, because
    // open clients only replace their partial maps when the key is present.
    if (!data.partialMaps?.length && ymap.has('partialMaps')) ymap.set('partialMaps', '[]');
    if (data.partialMaps?.length) {
      const mkCard = (c, id) => ({
        id,
        name: c.name || '', body: c.body || '', color: c.color || null,
        url: c.url || null, hidden: c.hidden || false, status: c.status || null,
        points: normalizePoints(c.points), tags: c.tags || [],
      });
      const statePMs = data.partialMaps.map(pm => {
        if (pm.columns) return pm; // already in state format
        const old = before.partialMaps.find(p => p.id === pm.id);
        const pmColumnIds = keepStepIds(pm.steps, old?.columns);
        const pmColumns = (pm.steps || []).map((step, i) => mkCard(step, pmColumnIds[i]));
        const userId = keepCardIds(rowGroups(pm.users, pmColumnIds), groupsByColumn(old?.users));
        const users = {};
        (pm.users || []).forEach((cards, i) => {
          if (i < pmColumns.length) users[pmColumns[i].id] = (cards || []).map((c, at) => mkCard(c, userId(pmColumns[i].id, '', at)));
        });
        const activityId = keepCardIds(rowGroups(pm.activities, pmColumnIds), groupsByColumn(old?.activities));
        const activities = {};
        (pm.activities || []).forEach((cards, i) => {
          if (i < pmColumns.length) activities[pmColumns[i].id] = (cards || []).map((c, at) => mkCard(c, activityId(pmColumns[i].id, '', at)));
        });
        const pmStoryId = keepCardIds(
          (pm.stories || []).slice(0, sliceIds.length).flatMap((sliceCards, si) => rowGroups(sliceCards, pmColumnIds, sliceIds[si])),
          Object.entries(old?.stories || {}).flatMap(([sliceId, byColumn]) => groupsByColumn(byColumn, sliceId)),
        );
        const stories = {};
        (pm.stories || []).forEach((sliceCards, si) => {
          if (si < sliceIds.length) {
            stories[sliceIds[si]] = {};
            (sliceCards || []).forEach((cards, ci) => {
              if (ci < pmColumns.length) stories[sliceIds[si]][pmColumns[ci].id] = (cards || []).map((c, at) => mkCard(c, pmStoryId(pmColumns[ci].id, sliceIds[si], at)));
            });
          }
        });
        return { id: pm.id, name: pm.name || '', columns: pmColumns, users, activities, stories };
      });
      ymap.set('partialMaps', JSON.stringify(statePMs));
    }

    // Activity log - skip on import to prevent injecting fake history
  });
};

export const countCards = (snapshot) => {
  const flat = (arr) => Array.isArray(arr) ? arr.reduce((n, a) => n + (Array.isArray(a) ? a.length : 0), 0) : 0;
  const steps = Array.isArray(snapshot.steps) ? snapshot.steps.filter(s => s.name && !s.partialMapId).length : 0;
  const stories = Array.isArray(snapshot.slices) ? snapshot.slices.reduce((n, s) => n + flat(s.stories), 0) : 0;
  return steps + flat(snapshot.users) + flat(snapshot.activities) + stories;
};
