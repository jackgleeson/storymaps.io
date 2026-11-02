import { readFile, writeFile, rename, rm, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// DATA_DIR lets the tests run a server with its own data folder
export const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data');
export const LOCK_FILE = join(DATA_DIR, 'locks.json');
export const BACKUPS_DIR = join(DATA_DIR, 'backups');
export const getBackupFile = (mapId) => join(BACKUPS_DIR, mapId + '.json');

export const ensureDataDir = async () => {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(BACKUPS_DIR, { recursive: true });
};

// A missing file gives the fallback. A file that can't be read is logged and gives the fallback
// too, so pages still load, but updateJson never saves over it.
export const readJson = async (filePath, fallback) => {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`Could not read ${filePath}:`, err.message);
    return fallback;
  }
};

const readJsonToChange = async (filePath, fallback) => {
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
  return JSON.parse(text);
};

// Changes to one file take turns, so two requests at once can't both read the old content and
// one of them lose the other's change
const turns = new Map();
const inTurn = (filePath, fn) => {
  const run = (turns.get(filePath) || Promise.resolve()).then(fn);
  const done = run.catch(() => {});
  turns.set(filePath, done);
  done.then(() => { if (turns.get(filePath) === done) turns.delete(filePath); });
  return run;
};

// Written to a file beside it and renamed over it, so nobody ever reads it empty or half written
const saveJson = async (filePath, data) => {
  const temp = `${filePath}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(data, null, 2));
    await rename(temp, filePath);
  } catch (err) {
    await rm(temp, { force: true });
    throw err;
  }
};

export const writeJson = (filePath, data) => inTurn(filePath, () => saveJson(filePath, data));

// Read a file, change it and save it, in one turn. fn changes the data in place or returns new
// data, or returns false to leave the file as it is. Answers with the data as saved.
export const updateJson = (filePath, fallback, fn) => inTurn(filePath, async () => {
  const data = await readJsonToChange(filePath, fallback);
  const result = await fn(data);
  if (result === false) return data;
  const next = result === undefined ? data : result;
  await saveJson(filePath, next);
  return next;
});

export const generateCardId = () => {
  const bytes = randomBytes(6);
  const num = Array.from(bytes).reduce((acc, b) => acc * 256n + BigInt(b), 0n);
  return num.toString(36).slice(-8).padStart(8, '0');
};
