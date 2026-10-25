import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// DATA_DIR lets the tests run a server with its own data folder
export const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data');
export const LOCK_FILE = join(DATA_DIR, 'locks.json');
export const STATS_FILE = join(DATA_DIR, 'stats.json');
export const BACKUPS_DIR = join(DATA_DIR, 'backups');
export const getBackupFile = (mapId) => join(BACKUPS_DIR, mapId + '.json');

export const ensureDataDir = async () => {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(BACKUPS_DIR, { recursive: true });
};

export const readJson = async (filePath, fallback) => {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
};

export const writeJson = async (filePath, data) => {
  await writeFile(filePath, JSON.stringify(data, null, 2));
};

export const generateCardId = () => {
  const bytes = randomBytes(6);
  const num = Array.from(bytes).reduce((acc, b) => acc * 256n + BigInt(b), 0n);
  return num.toString(36).slice(-8).padStart(8, '0');
};
