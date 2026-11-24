import { describe, test, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { WebsocketProvider } from 'y-websocket';
import { writeDocFromJson } from '../../server/serialization.js';
import { smallMap } from '../fixtures.js';
import { startServer } from './server-process.js';

// A map stored with a value the browser cannot draw is logged when someone opens it
let server, dataDir;
before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'storymaps-test-'));
  server = await startServer(dataDir, { BAD_VALUE_CHECK_MS: '300' });
});
after(async () => {
  await server.stop();
  await rm(dataDir, { recursive: true, force: true });
});

class BrowserWebSocket extends WebSocket {
  constructor(url, protocols) { super(url, protocols, { origin: 'http://localhost:3000' }); }
}
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
// Opens the map as a browser does, writes the given map into it, and stays for long enough to be checked
const openWith = async (mapId, data) => {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(server.wsBase, mapId, doc, { WebSocketPolyfill: BrowserWebSocket, disableBc: true });
  for (let i = 0; i < 100 && !provider.synced; i++) await wait(50);
  assert.ok(provider.synced, 'the first sync');
  writeDocFromJson(doc, data, Y);
  await wait(900);
  provider.destroy();
  doc.destroy();
};

describe('the bad values log', () => {
  test('names the map and the field, and not the value', async () => {
    const data = smallMap();
    data.slices[0].name = 31337;
    await openWith('badvalu1', data);
    const line = server.output().split('\n').find(l => l.includes('[bad-values] badvalu1'));
    assert.ok(line, server.output());
    assert.match(line, /1 not text: slices\[0\]\.name$/);
    assert.doesNotMatch(line, /31337/);
  });

  test('says nothing about a sound map', async () => {
    await openWith('goodmap1', smallMap());
    assert.doesNotMatch(server.output(), /\[bad-values\] goodmap1/);
  });
});
