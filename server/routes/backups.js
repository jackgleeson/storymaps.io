import { randomBytes } from 'node:crypto';

const MAX_BACKUPS = 8;

// Keep the newest backups by time. Imported backups can be older than the ones already here,
// such as the backup taken just before an import, so they mustn't push those out.
const keepNewest = (backups) => backups
  .sort((a, b) => (Date.parse(a.timestamp) || 0) - (Date.parse(b.timestamp) || 0))
  .slice(-MAX_BACKUPS);

// An imported backup keeps only the fields the app reads, with each one the type it expects. A
// time in the future would keep it newest for good and push out every real backup, so that
// becomes now.
const BACKUP_ID = /^[a-zA-Z0-9_-]{1,64}$/;
const text = (value) => (typeof value === 'string' ? value.slice(0, 500) : '');
export const cleanImportedBackup = (b, now = Date.now()) => {
  if (typeof b?.id !== 'string' || !BACKUP_ID.test(b.id) || typeof b.data !== 'string') return null;
  try {
    const map = JSON.parse(b.data);
    if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
  } catch {
    return null;
  }
  const time = Date.parse(b.timestamp);
  return {
    id: b.id,
    timestamp: new Date(Number.isFinite(time) && time <= now ? time : now).toISOString(),
    note: text(b.note),
    mapName: text(b.mapName),
    cardCount: Number.isSafeInteger(b.cardCount) && b.cardCount > 0 ? b.cardCount : 0,
    data: b.data,
    imported: true,
  };
};

export default function register(ctx) {
  const { route } = ctx;

  // Importing or deleting the backups of a locked map needs its password, as a push does
  const refuseIfLocked = async (req, res, mapId) => {
    const lock = (await ctx.readJson(ctx.LOCK_FILE, {}))[mapId];
    if (!lock?.isLocked || req.headers['x-lock-password'] === lock.passwordHash) return false;
    res.writeHead(423, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Map is locked' }));
    return true;
  };
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
    const entry = {
      id: randomBytes(6).toString('hex'),
      timestamp: new Date().toISOString(),
      note: body?.note || '',
      mapName: snapshot.name || '',
      cardCount: ctx.countCards(snapshot),
      data: JSON.stringify(snapshot),
    };
    await ctx.updateJson(ctx.getBackupFile(mapId), [], (backups) => keepNewest([...backups, entry]));
    // The app logs its own backups with the person's name. A request with no origin comes from the
    // CLI or a script, so the server logs it. Backups made as part of another change, like the one
    // before a restore, are left to that change's own entry.
    if (!req.headers.origin && !entry.note.startsWith('Auto: ')) await ctx.logToMap(mapId, 'Created backup');
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
    if (!ctx.stmtExists.get(mapId)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Map not found' }));
      return;
    }
    if (await refuseIfLocked(req, res, mapId)) return;
    const imported = (Array.isArray(body?.backups) ? body.backups : []).map(b => cleanImportedBackup(b)).filter(Boolean);
    if (imported.length) {
      await ctx.updateJson(ctx.getBackupFile(mapId), [], (existing) => {
        const existingIds = new Set(existing.map(b => b.id));
        for (const b of imported) {
          if (!existingIds.has(b.id)) existing.push(b);
        }
        return keepNewest(existing);
      });
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
    if (await refuseIfLocked(req, res, mapId)) return;
    await ctx.updateJson(ctx.getBackupFile(mapId), [], (backups) => {
      const idx = backups.findIndex(b => b.id === backupId);
      if (idx === -1) return false;
      backups.splice(idx, 1);
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
}
