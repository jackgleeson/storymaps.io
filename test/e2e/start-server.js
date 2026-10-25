// Starts server.js for the browser tests with its own data folder, removed again on exit
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'storymaps-e2e-'));
process.env.DATA_DIR = dataDir;
process.on('exit', () => rmSync(dataDir, { recursive: true, force: true }));

await import('../../server.js');
