// Storymaps.io — AGPL-3.0 — see LICENCE for details
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { basename, extname, join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { WebSocketServer } from 'ws';
import Database from 'better-sqlite3';

// Use createRequire to get the same CJS Yjs instance as y-websocket/bin/utils.cjs
// (avoids dual-instance issues when mixing ESM import with CJS require)
const _require = createRequire(import.meta.url);
const Y = _require('yjs');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 8080;

// Shared utilities
import { DATA_DIR, LOCK_FILE, STATS_FILE, BACKUPS_DIR, getBackupFile, ensureDataDir, readJson, writeJson, generateCardId } from './server/data.js';
import { isRateLimited, isProxyRateLimited, isCreateRateLimited } from './server/rate-limit.js';
import { sanitizeFilename } from './server/http-helpers.js';
import { serializeDoc, contentEtag, loadAndSerialize, appendLogEntry, diffPush, writeDocFromJson, countCards } from './server/serialization.js';
import { createRouter } from './server/router.js';
import { createProjects } from './server/projects.js';
import { isOriginAllowed, isCliApi, parseBody } from './server/middleware.js';

// Shared client modules: pure transform functions used by both server (format URLs,
// YAML body parsing) and client (import/export UI). Safe to share in this monolith
// since both sides run in Node.js/browser with identical logic.
import { jsonToYamlObj, dumpYaml } from './src/transfer/yaml.js';
import { exportToCsv } from './src/transfer/csv.js';

// Set YPERSISTENCE *before* importing y-websocket utils, which reads it at load time
process.env.YPERSISTENCE = DATA_DIR;
const { setupWSConnection, docs, getPersistence } = await import('y-websocket/bin/utils');

// =============================================================================
// SQLite Map Index
// =============================================================================

const DB_FILE = join(DATA_DIR, 'maps.db');
await ensureDataDir();
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS maps (
    id TEXT PRIMARY KEY,
    name TEXT,
    created_at TEXT,
    updated_at TEXT
  )
`);

// Total edits per map = activity-log entries, counted from when this column was added.
// The date counting started is kept so older maps can show "since <date>".
sqlite.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
if (!sqlite.prepare('PRAGMA table_info(maps)').all().some(c => c.name === 'edit_count')) {
  sqlite.exec('ALTER TABLE maps ADD COLUMN edit_count INTEGER NOT NULL DEFAULT 0');
  sqlite.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('edit_count_since', ?)").run(new Date().toISOString());
}
const editCountSince = sqlite.prepare("SELECT value FROM meta WHERE key = 'edit_count_since'").get()?.value || null;

const stmtInsert = sqlite.prepare(
  'INSERT OR IGNORE INTO maps (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)'
);
const stmtUpdate = sqlite.prepare(
  'UPDATE maps SET name = ?, updated_at = ?, edit_count = edit_count + ? WHERE id = ?'
);
const stmtExists = sqlite.prepare('SELECT 1 FROM maps WHERE id = ?');
const stmtMeta = sqlite.prepare('SELECT created_at, updated_at, edit_count FROM maps WHERE id = ?');

// Map and project IDs: 8 lower-case letters and digits
const randomId = () => {
  const num = Array.from(randomBytes(6)).reduce((acc, b) => acc * 256n + BigInt(b), 0n);
  return num.toString(36).slice(-8).padStart(8, '0');
};

// Projects: maps grouped as tabs, kept in their own tables next to the map index
const projects = createProjects(sqlite, { generateId: randomId });

const generateUniqueMapId = () => {
  for (let i = 0; i < 10; i++) {
    const id = randomId();
    if (!stmtExists.get(id)) return id;
  }
  throw new Error('Failed to generate unique ID');
};

// =============================================================================
// Route Context + Registration
// =============================================================================

const { route, matchRoute } = createRouter();

const ctx = {
  route,
  Y, docs, getPersistence,
  stmtInsert, stmtUpdate, stmtExists, stmtMeta, editCountSince, projects,
  getPendingEdits: (mapId) => pendingEdits.get(mapId) || 0,
  readJson, writeJson, DATA_DIR, LOCK_FILE, STATS_FILE, getBackupFile,
  serializeDoc, contentEtag, appendLogEntry, diffPush, writeDocFromJson, countCards,
  isRateLimited, isProxyRateLimited, isCreateRateLimited,
  generateUniqueMapId, generateCardId,
  loadAndSerialize: (mapId, host) => loadAndSerialize(mapId, host, { Y, docs, getPersistence, readJson, LOCK_FILE, getBackupFile }),
};

// Register all route modules
import registerStats from './server/routes/stats.js';
import registerLocks from './server/routes/locks.js';
import registerBackups from './server/routes/backups.js';
import registerProjects from './server/routes/projects.js';
import registerMaps from './server/routes/maps.js';
import registerExportJira from './server/routes/export-jira.js';
import registerExportPhabricator from './server/routes/export-phabricator.js';
import registerExportAsana from './server/routes/export-asana.js';
import registerExportLinear from './server/routes/export-linear.js';
import registerImportJira from './server/routes/import-jira.js';
import registerImportAsana from './server/routes/import-asana.js';
import registerImportLinear from './server/routes/import-linear.js';
import registerImportPhabricator from './server/routes/import-phabricator.js';

// Static routes before parameterized ones
registerStats(ctx);
registerMaps(ctx);    // /api/maps/new-id must register before /api/maps/:id
registerLocks(ctx);
registerBackups(ctx);
registerProjects(ctx);
// Imports and exports through the APIs of Jira, Asana, Phabricator and Linear make this server
// call addresses that people type in. IMPORT_EXPORT_ENABLED=false turns them off, and the app
// hides them. Imports and exports of files still work.
const IMPORT_EXPORT_ENABLED = process.env.IMPORT_EXPORT_ENABLED !== 'false';
if (IMPORT_EXPORT_ENABLED) {
  registerExportJira(ctx);
  registerExportPhabricator(ctx);
  registerExportAsana(ctx);
  registerExportLinear(ctx);
  registerImportJira(ctx);
  registerImportAsana(ctx);
  registerImportLinear(ctx);
  registerImportPhabricator(ctx);
}

// =============================================================================
// Static File Config
// =============================================================================

const PUBLIC_DIR = join(__dirname, 'public');
const SRC_DIR = join(__dirname, 'src');
const STATIC_DIRS = [PUBLIC_DIR, SRC_DIR];

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.yaml': 'text/yaml',
  '.csv': 'text/csv',
};

// Extensions worth gzipping (text-based formats)
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.svg', '.xml', '.txt']);

// In-memory static file cache: path -> { etag, raw, gzipped, contentType, cacheControl }
const fileCache = new Map();

// Cache strategy: short cache for code (CDN/browser + ETag revalidation), long cache for assets
const cacheHeader = (ext) => {
  if (['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2'].includes(ext)) {
    return 'public, max-age=86400'; // Images/fonts: 1 day
  }
  return 'public, max-age=10, must-revalidate'; // HTML/JS/CSS: 10s cache, then ETag revalidation
};

// =============================================================================
// HTTP Server
// =============================================================================

const server = createServer(async (req, res) => {
  try {
  const reqPath = req.url.split('?')[0];

  // API routes
  if (reqPath.startsWith('/api/')) {
    const matched = matchRoute(req.method, reqPath);
    if (!matched) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    // Check origin for write requests (skip for CLI API routes - rate-limited instead)
    if (['POST', 'PUT', 'DELETE'].includes(req.method) && !isCliApi(reqPath, req.method) && !isOriginAllowed(req.headers.origin)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden' }));
      return;
    }

    // Parse body for write methods
    let body = null;
    if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
      body = await parseBody(req);
      if (body === null && req.destroyed) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body too large' }));
        return;
      }
      if (body?.validationErrors) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'YAML validation failed', errors: body.validationErrors, warnings: body.validationWarnings || [] }));
        return;
      }
      if (body?.parseError) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }
    }

    await matched.handler(req, res, matched.params, body);
    return;
  }

  // Redirect /favicon.ico -> /favicon.svg (browsers request .ico for non-HTML pages)
  if (reqPath === '/favicon.ico') {
    res.writeHead(302, { 'Location': '/favicon.svg' });
    res.end();
    return;
  }

  // Static files - try cache first, then disk
  let relPath = reqPath === '/' ? '/index.html' : reqPath;
  const ext = extname(relPath);

  // Resolve cache key: SPA fallback uses '/index.html'
  let cacheKey = relPath;
  let cached = fileCache.get(cacheKey);

  if (!cached) {
    // Try to read from disk (resolve + startsWith guard against path traversal)
    let content;
    for (const dir of STATIC_DIRS) {
      // Strip leading / and matching dir prefix (e.g. /src/app.js -> app.js for SRC_DIR)
      let filePart = relPath.slice(1);
      const dirName = basename(dir);
      if (filePart.startsWith(dirName + '/')) filePart = filePart.slice(dirName.length + 1);
      const resolved = resolve(dir, filePart);
      if (!resolved.startsWith(dir + '/') && resolved !== dir) continue;
      try {
        content = await readFile(resolved);
        break;
      } catch {
        // Try next directory
      }
    }

    // Format extension: /:mapId.json, /:mapId.yaml, or /:mapId.csv
    if (!content && !reqPath.includes('/', 1) && (ext === '.json' || ext === '.yaml' || ext === '.csv')) {
      const mapId = reqPath.slice(1, -ext.length);
      if (mapId) {
        const data = await ctx.loadAndSerialize(mapId, req.headers.host);
        if (data) {
          const body = ext === '.csv'
            ? exportToCsv(data)
            : ext === '.yaml'
              ? dumpYaml(jsonToYamlObj(data))
              : JSON.stringify(data, null, 2);
          const ct = ext === '.csv' ? 'text/csv' : ext === '.yaml' ? 'text/yaml' : 'application/json';
          const headers = { 'Content-Type': ct + '; charset=utf-8', 'Cache-Control': 'no-store' };
          if (ext === '.csv') headers['Content-Disposition'] = `attachment; filename="${sanitizeFilename(data.name) + '.csv'}"`;
          res.writeHead(200, headers);
          res.end(body);
          return;
        }
      }
    }

    // SPA fallback: serve index.html for map URLs (no extension, not in subdirectories), samples,
    // and project links: /p/<project id> and /p/<project id>/<map id>, with or without a slash on the end
    let isHtmlFallback = false;
    const isProjectPath = /^\/p\/[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)?\/?$/.test(reqPath);
    if (!content && ext === '' && (!reqPath.includes('/', 1) || reqPath.startsWith('/sample/') || isProjectPath)) {
      cacheKey = '/index.html';
      cached = fileCache.get(cacheKey);
      if (!cached) {
        try {
          content = await readFile(join(PUBLIC_DIR, 'index.html'));
          isHtmlFallback = true;
        } catch {
          // Fall through to 404
        }
      }
    }

    // Tell the app when imports and exports through tracker APIs are turned off
    if (content && cacheKey === '/index.html' && !IMPORT_EXPORT_ENABLED) {
      content = Buffer.from(content.toString().replace('<html lang="en">', '<html lang="en" data-integrations="off">'));
    }

    // Build cache entry from disk content
    if (content && !cached) {
      const fileExt = isHtmlFallback ? '.html' : ext;
      const etag = `"${createHash('md5').update(content).digest('hex')}"`;
      cached = {
        etag,
        raw: content,
        gzipped: COMPRESSIBLE.has(fileExt) ? gzipSync(content) : null,
        contentType: isHtmlFallback ? 'text/html' : (MIME_TYPES[ext] || 'application/octet-stream'),
        cacheControl: cacheHeader(fileExt),
      };
      fileCache.set(cacheKey, cached);
    }
  }

  if (cached) {
    if (req.headers['if-none-match'] === cached.etag) {
      res.writeHead(304, { 'Cache-Control': cached.cacheControl });
      res.end();
      return;
    }

    const headers = {
      'Content-Type': cached.contentType,
      'Cache-Control': cached.cacheControl,
      'ETag': cached.etag,
    };

    const acceptGzip = (req.headers['accept-encoding'] || '').includes('gzip');
    if (acceptGzip && cached.gzipped) {
      headers['Content-Encoding'] = 'gzip';
      res.writeHead(200, headers);
      res.end(cached.gzipped);
    } else {
      res.writeHead(200, headers);
      res.end(cached.raw);
    }
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }
  } catch (err) {
    console.error('Request error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  }
});

// =============================================================================
// SQLite Update Tracking
// =============================================================================

// Debounce map for update writes (mapId -> timeout)
const updateTimers = new Map();
// Activity-log entries seen since the last write (mapId -> count), saved with updated_at
const pendingEdits = new Map();
// Log entries older than this are replays from a reconnecting client, not new edits
const RECENT_EDIT_MS = 10 * 60_000;

// y-websocket drops a doc from `docs` before destroying it, so callers pass the doc in
const flushMapUpdate = (mapId, doc = docs.get(mapId)) => {
  if (!updateTimers.has(mapId)) return;
  clearTimeout(updateTimers.get(mapId));
  updateTimers.delete(mapId);
  try {
    if (doc) {
      const ymap = doc.getMap('storymap');
      const name = ymap.get('name') || 'untitled';
      const edits = pendingEdits.get(mapId) || 0;
      pendingEdits.delete(mapId);
      stmtUpdate.run(name, new Date().toISOString(), edits, mapId);
    }
  } catch (err) {
    console.error(`SQLite flush error for ${mapId}:`, err.message);
  }
};

const trackMapUpdate = (mapId, doc) => {
  if (updateTimers.has(mapId)) clearTimeout(updateTimers.get(mapId));
  updateTimers.set(mapId, setTimeout(() => flushMapUpdate(mapId, doc), 2_000));
};

// Track which docs we've already hooked
const trackedDocs = new Set();

// =============================================================================
// WebSocket Server
// =============================================================================

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  if (!isOriginAllowed(req.headers.origin)) {
    ws.close(4403, 'Forbidden');
    return;
  }
  setupWSConnection(ws, req);

  // Hook into the doc for SQLite tracking
  const docName = (req.url || '').slice(1).split('?')[0];
  const doc = docs.get(docName);
  if (doc && !trackedDocs.has(docName)) {
    trackedDocs.add(docName);

    // Record map creation (INSERT OR IGNORE - won't overwrite migrated data)
    const now = new Date().toISOString();
    stmtInsert.run(docName, 'untitled', now, now);

    // Track updates with debounce
    doc.on('update', () => trackMapUpdate(docName, doc));

    // Count activity-log entries from connected clients. Loading a map from disk replays
    // its log with no origin, and CLI pushes are counted by the PUT route.
    // A client that connects before the map has loaded from disk re-sends entries the server
    // doesn't have yet, so only count entries created in the last few minutes.
    doc.getArray('log').observe((event) => {
      if (!event.transaction.origin) return;
      const cutoff = Date.now() - RECENT_EDIT_MS;
      const added = event.changes.delta.reduce((n, d) =>
        n + (d.insert ? d.insert.filter(entry => typeof entry?.ts === 'number' && entry.ts > cutoff).length : 0), 0);
      if (added) pendingEdits.set(docName, (pendingEdits.get(docName) || 0) + added);
    });

    // Flush pending writes when all clients disconnect and doc closes
    doc.on('destroy', () => {
      flushMapUpdate(docName, doc);
      trackedDocs.delete(docName);
    });
  }
});

// =============================================================================
// Start
// =============================================================================

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
});

// Log active presence every 30 seconds
setInterval(() => {
  const rooms = [];
  for (const [name, doc] of docs) {
    const count = doc.awareness.getStates().size;
    if (count > 0) rooms.push(`${name}(${count})`);
  }
  if (rooms.length > 0) {
    console.log(`[${new Date().toISOString()}] [presence] ${rooms.length} active rooms: ${rooms.join(', ')}`);
  }
}, 30_000);

// Graceful shutdown: stop connections, flush LevelDB + SQLite, then exit
const gracefulShutdown = async () => {
  // Force exit after 5s if cleanup hangs
  const forceExit = setTimeout(() => {
    console.error('Shutdown timed out, forcing exit.');
    process.exit(1);
  }, 5_000);
  forceExit.unref();

  try {
    console.log('Shutting down...');

    // Stop accepting new connections
    server.close();
    wss.close();

    // Close all WebSocket clients
    for (const ws of wss.clients) {
      ws.close();
    }

    // Flush all active Yjs docs to LevelDB, then destroy
    const persistence = getPersistence();
    for (const [name, doc] of docs) {
      try {
        if (persistence) await persistence.writeState(name, doc);
        doc.destroy();
      } catch (err) {
        console.error(`Error flushing doc ${name}:`, err.message);
      }
    }

    // Close LevelDB
    if (persistence?.provider?.destroy) {
      await persistence.provider.destroy();
    }

    // Flush pending SQLite writes
    for (const mapId of updateTimers.keys()) {
      flushMapUpdate(mapId);
    }
    sqlite.close();

    console.log('Shutdown complete.');
  } catch (err) {
    console.error('Error during shutdown:', err);
  } finally {
    process.exit(0);
  }
};
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
