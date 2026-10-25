import { describe, test, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from './server-process.js';

// IMPORT_EXPORT_ENABLED=false turns off imports and exports through the APIs of Jira, Asana,
// Phabricator and Linear, so the server never calls an address someone typed in
const TRACKER_ROUTES = [
  '/api/import/jira', '/api/import/asana', '/api/import/linear', '/api/import/phabricator',
  '/api/export/jira', '/api/export/jira/verify', '/api/export/asana', '/api/export/asana/verify',
  '/api/export/linear', '/api/export/linear/verify', '/api/export/phabricator', '/api/export/phabricator/verify',
];

const post = (base, path) => fetch(base + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: '{}',
});

for (const [label, env, enabled] of [['on by default', {}, true], ['IMPORT_EXPORT_ENABLED=false', { IMPORT_EXPORT_ENABLED: 'false' }, false]]) {
  describe(`tracker imports and exports, ${label}`, () => {
    let server, dataDir;
    before(async () => {
      dataDir = await mkdtemp(join(tmpdir(), 'storymaps-test-'));
      server = await startServer(dataDir, env);
    });
    after(async () => {
      await server.stop();
      await rm(dataDir, { recursive: true, force: true });
    });

    test(enabled ? 'the routes answer' : 'the routes are not there', async () => {
      for (const path of TRACKER_ROUTES) {
        const { status } = await post(server.base, path);
        if (enabled) assert.notEqual(status, 404, path);
        else assert.equal(status, 404, path);
      }
    });

    test(enabled ? 'the app is not told to hide them' : 'the app is told to hide them', async () => {
      for (const path of ['/', '/abcd1234', '/index.html']) {
        const html = await (await fetch(server.base + path)).text();
        assert.equal(html.includes('<html lang="en" data-integrations="off">'), !enabled, path);
      }
    });

    test('imports of files are not affected', async () => {
      const { status } = await post(server.base, '/api/maps');
      assert.equal(status, 201);
    });
  });
}
