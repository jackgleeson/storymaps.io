// Delete one map by ID: its Yjs data, map index row, project tabs, backups and lock, keeping only the
// ID so the map can't be brought back at its old link. One map per run, so a slip can never delete
// more than that.
//
//   node server/admin/delete-map.js --dry-run <id>   show what would be deleted
//   node server/admin/delete-map.js <id>             delete
//
// LevelDB allows one process at a time, so stop the server first. With Docker Compose:
//   docker compose stop app
//   docker compose run --rm app node server/admin/delete-map.js <id>
//   docker compose start app
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { LeveldbPersistence } from 'y-leveldb';
import { DATA_DIR, LOCK_FILE, getBackupFile, readJson, updateJson } from '../data.js';
import { createProjects } from '../projects.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const ids = args.filter(a => a !== '--dry-run');

const fail = (message) => {
  console.error(message);
  process.exit(1);
};
if (ids.length !== 1) fail('Give exactly one map ID: node server/admin/delete-map.js [--dry-run] <id>');
const [id] = ids;
// Same characters the API allows in a map ID, so the ID can't point outside the data folder
if (!/^[a-zA-Z0-9_-]+$/.test(id)) fail(`Not a map ID: ${id}`);

const persistence = new LeveldbPersistence(DATA_DIR);
const sqlite = new Database(join(DATA_DIR, 'maps.db'));
const projects = createProjects(sqlite, { generateId: () => { throw new Error('Not used'); } });
try {
  // Every lookup matches the ID exactly, so a map whose ID starts the same way is never touched
  const locks = await readJson(LOCK_FILE, {});
  const found = {
    data: (await persistence.getAllDocNames()).includes(id),
    index: !!sqlite.prepare('SELECT 1 FROM maps WHERE id = ?').get(id),
    projects: projects.countForMap(id) > 0,
    backups: existsSync(getBackupFile(id)),
    lock: Object.hasOwn(locks, id),
  };
  const what = Object.keys(found).filter(name => found[name]);
  if (what.length === 0) fail(`${id}: not found`);

  if (!dryRun) {
    // Kept so the server never brings the map back at its old link: a push from an old copy, or a
    // tab still open on it, is refused. Only the ID is kept, nothing from the map.
    sqlite.exec('CREATE TABLE IF NOT EXISTS deleted_maps (id TEXT PRIMARY KEY, deleted_at TEXT)');
    sqlite.prepare('INSERT OR IGNORE INTO deleted_maps (id, deleted_at) VALUES (?, ?)').run(id, new Date().toISOString());
    if (found.data) await persistence.clearDocument(id);
    if (found.index) sqlite.prepare('DELETE FROM maps WHERE id = ?').run(id);
    if (found.projects) projects.forget(id);
    if (found.backups) await rm(getBackupFile(id));
    if (found.lock) {
      await updateJson(LOCK_FILE, {}, (current) => { delete current[id]; });
    }
  }
  console.log(`${id}: ${dryRun ? 'would delete' : 'deleted'} ${what.join(', ')}`);
} finally {
  sqlite.close();
  await persistence.destroy();
}
