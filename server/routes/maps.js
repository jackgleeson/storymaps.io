import { jsonToYamlObj, dumpYaml } from '../../src/transfer/yaml.js';
import { exportToCsv } from '../../src/transfer/csv.js';
import { sanitizeFilename } from '../http-helpers.js';

export default function register(ctx) {
  const { route } = ctx;
  // GET /api/maps/new-id - generate unique map ID
  route('GET', '/api/maps/new-id', async (req, res) => {
    if (ctx.isRateLimited(req)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
      return;
    }
    try {
      const id = ctx.generateUniqueMapId();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ id }));
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to generate unique ID' }));
    }
  });

  // POST /api/maps - create a new map
  route('POST', '/api/maps', async (req, res, params, body) => {
    if (ctx.isCreateRateLimited(req)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many new maps from your address. Try again later.' }));
      return;
    }
    try {
      const id = ctx.generateUniqueMapId();
      const now = new Date().toISOString();

      const hasData = body.steps?.length || body.slices?.length;
      if (hasData) {
        const doc = new ctx.Y.Doc();
        ctx.writeDocFromJson(doc, body, ctx.Y);
        ctx.appendLogEntry(doc, 'Created map via CLI');
        const persistence = ctx.getPersistence();
        if (persistence) {
          await persistence.provider.storeUpdate(id, ctx.Y.encodeStateAsUpdate(doc));
        }
        doc.destroy();
      }

      ctx.stmtInsert.run(id, body.name || 'untitled', now, now);
      const stats = await ctx.readJson(ctx.STATS_FILE, { mapCount: 0 });
      stats.mapCount = (stats.mapCount || 0) + 1;
      await ctx.writeJson(ctx.STATS_FILE, stats);

      const site = (req.headers.host || '').replace(/:\d+$/, '');
      const proto = req.headers['x-forwarded-proto'] || 'http';
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id, url: `${proto}://${site}/${id}`, created_at: now }));
    } catch (err) {
      console.error('POST /api/maps error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to create map' }));
    }
  });

  // GET /api/maps/:id - pull map data
  route('GET', '/api/maps/:id', async (req, res, { id: mapId }) => {
    const data = await ctx.loadAndSerialize(mapId, req.headers.host);
    if (!data) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Map not found' }));
      return;
    }
    const { backups, ...clean } = data;
    const etag = ctx.contentEtag(data);
    const url = new URL(req.url, `http://${req.headers.host}`);
    const format = url.searchParams.get('format');
    if (format === 'yaml') {
      const yamlStr = dumpYaml(jsonToYamlObj(clean));
      res.writeHead(200, { 'Content-Type': 'text/yaml; charset=utf-8', 'Cache-Control': 'no-cache', 'ETag': etag });
      res.end(yamlStr);
    } else if (format === 'csv') {
      const csvStr = exportToCsv(clean);
      const fn = sanitizeFilename(clean.name) + '.csv';
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${fn}"`, 'Cache-Control': 'no-cache', 'ETag': etag });
      res.end(csvStr);
    } else {
      const jsonBody = JSON.stringify(clean, null, 2);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'ETag': etag });
      res.end(jsonBody);
    }
  });

  // GET /api/maps/:id/meta - created/updated dates and total edits, for the Log panel
  route('GET', '/api/maps/:id/meta', async (req, res, { id: mapId }) => {
    const row = ctx.stmtMeta.get(mapId);
    if (!row) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Map not found' }));
      return;
    }
    // Edits were only counted from when the counter was added, so older maps report that date
    const editsSince = ctx.editCountSince && (!row.created_at || row.created_at < ctx.editCountSince)
      ? ctx.editCountSince : row.created_at;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({
      created_at: row.created_at,
      updated_at: row.updated_at,
      edit_count: row.edit_count + ctx.getPendingEdits(mapId),
      edits_since: editsSince,
    }));
  });

  // GET /api/maps/:id/log - activity log entries
  route('GET', '/api/maps/:id/log', async (req, res, { id: mapId }) => {
    let doc = ctx.docs.get(mapId);
    let created = false;
    if (!doc) {
      const persistence = ctx.getPersistence();
      if (!persistence) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Persistence unavailable' }));
        return;
      }
      doc = new ctx.Y.Doc();
      await persistence.bindState(mapId, doc);
      created = true;
    }
    const ymap = doc.getMap('storymap');
    if (ymap.size === 0) {
      if (created) doc.destroy();
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Map not found' }));
      return;
    }
    const entries = doc.getArray('log').toArray().reverse();
    if (created) doc.destroy();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify(entries));
  });

  // PUT /api/maps/:id - push map data
  route('PUT', '/api/maps/:id', async (req, res, { id: mapId }, body) => {
    if (ctx.isRateLimited(req)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
      return;
    }

    if (!body.steps?.length && !body.slices?.length) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Body must contain steps or slices' }));
      return;
    }

    // Check lock
    const locks = await ctx.readJson(ctx.LOCK_FILE, {});
    if (locks[mapId]?.isLocked) {
      const lockPassword = req.headers['x-lock-password'];
      if (!lockPassword || lockPassword !== locks[mapId].passwordHash) {
        res.writeHead(423, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Map is locked' }));
        return;
      }
    }

    // ETag conflict detection
    const ifMatch = req.headers['if-match'];
    if (ifMatch) {
      const current = await ctx.loadAndSerialize(mapId, req.headers.host);
      if (current) {
        const currentEtag = ctx.contentEtag(current);
        if (ifMatch !== currentEtag) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Conflict: map has been modified since last pull. Pull again to get the latest version.' }));
          return;
        }
      }
    }

    try {
      const existingDoc = ctx.docs.get(mapId);
      // A push adds one activity-log entry, which counts as one edit
      let logged = false;

      if (existingDoc) {
        const oldSnapshot = ctx.serializeDoc(existingDoc);
        ctx.writeDocFromJson(existingDoc, body, ctx.Y);
        const result = ctx.diffPush(oldSnapshot, body, existingDoc);
        if (result) { ctx.appendLogEntry(existingDoc, result.text, result.ids); logged = true; }
      } else {
        const persistence = ctx.getPersistence();
        if (!persistence) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Persistence unavailable' }));
          return;
        }
        const doc = new ctx.Y.Doc();
        await persistence.bindState(mapId, doc);
        const oldSnapshot = ctx.serializeDoc(doc);
        ctx.writeDocFromJson(doc, body, ctx.Y);
        const result = ctx.diffPush(oldSnapshot, body, doc);
        if (result) { ctx.appendLogEntry(doc, result.text, result.ids); logged = true; }
        await persistence.provider.storeUpdate(mapId, ctx.Y.encodeStateAsUpdate(doc));
        doc.destroy();
      }

      const now = new Date().toISOString();
      if (!ctx.stmtExists.get(mapId)) ctx.stmtInsert.run(mapId, body.name || 'untitled', now, now);
      ctx.stmtUpdate.run(body.name || 'untitled', now, logged ? 1 : 0, mapId);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id: mapId, updated_at: now }));
    } catch (err) {
      console.error(`PUT /api/maps/${mapId} error:`, err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to update map' }));
    }
  });
}
