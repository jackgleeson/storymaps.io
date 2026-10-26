// Delete one map by ID: its Yjs data, map index row, project tabs, backups and lock. One map per run, so a
// slip can never delete more than that.
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
import { DATA_DIR, LOCK_FILE, getBackupFile, readJson, writeJson } from '../data.js';
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
    if (found.data) await persistence.clearDocument(id);
    if (found.index) sqlite.prepare('DELETE FROM maps WHERE id = ?').run(id);
    if (found.projects) projects.forget(id);
    if (found.backups) await rm(getBackupFile(id));
    if (found.lock) {
      delete locks[id];
      await writeJson(LOCK_FILE, locks);
    }
  }
  console.log(`${id}: ${dryRun ? 'would delete' : 'deleted'} ${what.join(', ')}`);
} finally {
  sqlite.close();
  await persistence.destroy();
}
