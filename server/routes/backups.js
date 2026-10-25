import { randomBytes } from 'node:crypto';

const MAX_BACKUPS = 5;

// Keep the newest backups by time. Imported backups can be older than the ones already here,
// such as the backup taken just before an import, so they mustn't push those out.
const keepNewest = (backups) => backups
  .sort((a, b) => (Date.parse(a.timestamp) || 0) - (Date.parse(b.timestamp) || 0))
  .slice(-MAX_BACKUPS);

export default function register(ctx) {
  const { route } = ctx;
  route('GET', '/api/backups/:mapId', async (req, res, { mapId }) => {
    const backups = await ctx.readJson(ctx.getBackupFile(mapId), []);
    const meta = backups.map(b => ({
      id: b.id, timestamp: b.timestamp, note: b.note,
      mapName: b.mapName || '',
      size: b.data ? b.data.length : 0,
      cardCount: b.cardCount || 0,
      ...(b.imported && { imported: true }),
    }));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify(meta));
  });

  route('POST', '/api/backups/:mapId', async (req, res, { mapId }, body) => {
    if (ctx.isProxyRateLimited(req)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many attempts' }));
      return;
    }
    const data = await ctx.loadAndSerialize(mapId, req.headers.host);
    if (!data) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Map not found' }));
      return;
    }
    const { id, site, locked, exported, backups: _b, ...snapshot } = data;
    const backups = await ctx.readJson(ctx.getBackupFile(mapId), []);
    const entry = {
      id: randomBytes(6).toString('hex'),
      timestamp: new Date().toISOString(),
      note: body?.note || '',
      mapName: snapshot.name || '',
      cardCount: ctx.countCards(snapshot),
      data: JSON.stringify(snapshot),
    };
    backups.push(entry);
    await ctx.writeJson(ctx.getBackupFile(mapId), keepNewest(backups));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: entry.id, timestamp: entry.timestamp, note: entry.note, mapName: entry.mapName, size: entry.data.length, cardCount: entry.cardCount }));
  });

  // Register /import before /:backupId so "import" isn't captured as a backupId
  route('POST', '/api/backups/:mapId/import', async (req, res, { mapId }, body) => {
    if (ctx.isProxyRateLimited(req)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many attempts' }));
      return;
    }
    const imported = Array.isArray(body?.backups) ? body.backups : [];
    if (imported.length) {
      const existing = await ctx.readJson(ctx.getBackupFile(mapId), []);
      const existingIds = new Set(existing.map(b => b.id));
      for (const b of imported) {
        if (b.id && b.data && !existingIds.has(b.id)) existing.push({ ...b, imported: true });
      }
      await ctx.writeJson(ctx.getBackupFile(mapId), keepNewest(existing));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });

  route('GET', '/api/backups/:mapId/:backupId', async (req, res, { mapId, backupId }) => {
    const backups = await ctx.readJson(ctx.getBackupFile(mapId), []);
    const backup = backups.find(b => b.id === backupId);
    if (!backup) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Backup not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify(backup));
  });

  route('DELETE', '/api/backups/:mapId/:backupId', async (req, res, { mapId, backupId }) => {
    const backups = await ctx.readJson(ctx.getBackupFile(mapId), []);
    const idx = backups.findIndex(b => b.id === backupId);
    if (idx !== -1) {
      backups.splice(idx, 1);
      await ctx.writeJson(ctx.getBackupFile(mapId), backups);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
}
