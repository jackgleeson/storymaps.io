import { describe, test, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { state as sharedState } from '/src/core/state.js';
import { serialize, deserialize } from '/src/core/serialization.js';
import { serializeDoc, writeDocFromJson } from '../../server/serialization.js';
import { fullMap, smallMap } from '../fixtures.js';

// The browser modules look up the board name, ask for animation frames and read the site name
globalThis.document ??= { getElementById: () => ({ value: '' }) };
globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);
globalThis.window ??= { location: { hostname: 'storymaps.io' } };

// The same Yjs build the browser uses, so documents from every client are compatible
const Y = await import('/vendor/yjs.bundle.js');

const emptyState = () => ({ mapId: null, name: '', columns: [], users: {}, activities: {}, slices: [], legend: [], notes: '', partialMaps: [] });

// Each client is its own copy of the Yjs module with its own state, like a browser tab.
// createYjsDoc(null) makes the shared document without connecting to a server.
let clientCount = 0;
const clients = [];
const makeClient = async ({ editable = true } = {}) => {
  const yjs = await import(`/src/core/yjs.js?client=${++clientCount}`);
  const client = { yjs, state: emptyState(), renders: 0, editable };
  yjs.init({
    state: client.state,
    notepad: {
      migrateLegacyNotes: (ymap, ytext, s) => { if (ytext.length) s.notes = ytext.toString(); },
      bindYjs() {}, unbindYjs() {},
    },
    log: { bindYjs() {}, unbindYjs() {} },
    isMapEditable: () => client.editable,
    render: () => { client.renders++; },
    setPreserveToolbar() {},
  });
  await yjs.createYjsDoc(null);
  client.doc = yjs.getYdoc();
  clients.push(client);
  return client;
};

afterEach(() => { while (clients.length) clients.pop().yjs.destroyYjs(); });

// Load a map into a client's state the way the app does, then save it to the shared document
const load = (client, map) => {
  deserialize({ app: 'storymap', v: 1, ...map });
  Object.assign(client.state, structuredClone({ ...sharedState, mapId: null }));
  client.yjs.syncToYjs();
};

// What serialize() would export from a client's state
const exported = (client) => {
  Object.assign(sharedState, structuredClone(client.state));
  const { app, v, exported: _e, site, id, ...rest } = serialize();
  return rest;
};

const serverView = (doc) => {
  const { app, v, exported: _e, ...rest } = serializeDoc(doc);
  return rest;
};

// Send everything one client has that the other doesn't, as a remote change
const send = (from, to) => {
  Y.applyUpdate(to.doc, Y.encodeStateAsUpdate(from.doc, Y.encodeStateVector(to.doc)), 'remote');
  to.yjs.syncFromYjs();
};
const exchange = (a, b) => { send(a, b); send(b, a); };

const storyNames = (client, sliceIdx = 0) => {
  const cols = client.state.columns;
  return cols.map(col => (client.state.slices[sliceIdx].stories[col.id] || []).map(s => s.name));
};

describe('saving to the shared document', () => {
  test('the server reads back the map the browser saved', async () => {
    const a = await makeClient();
    load(a, fullMap());
    assert.deepEqual(serverView(a.doc), fullMap());
  });

  test('0 story points are saved', async () => {
    const a = await makeClient();
    load(a, smallMap());
    a.state.slices[0].stories[a.state.columns[0].id][0].points = 0;
    a.yjs.syncToYjs();
    assert.equal(serverView(a.doc).slices[0].stories[0][0].points, 0);
  });

  test('changing points to 0 is saved', async () => {
    const a = await makeClient();
    load(a, { ...smallMap(), steps: [{ name: 'Sign up', points: 3 }, { name: 'Pay' }] });
    a.state.columns[0].points = 0;
    a.yjs.syncToYjs();
    assert.equal(serverView(a.doc).steps[0].points, 0);
  });

  test('editing a card updates it in place', async () => {
    const a = await makeClient();
    load(a, smallMap());
    const yCards = a.doc.getMap('storymap').get('slices').get(0).get('stories').get(a.state.columns[0].id);
    const before = yCards.get(0);
    a.state.slices[0].stories[a.state.columns[0].id][0].name = 'Email and password';
    a.yjs.syncToYjs();
    assert.equal(yCards.get(0), before, 'same shared card');
    assert.equal(before.get('name'), 'Email and password');
  });

  test('moving a card only replaces the card that moved', async () => {
    const a = await makeClient();
    load(a, { ...smallMap(), slices: [{ name: 'MVP', stories: [[{ name: 'One' }, { name: 'Two' }, { name: 'Three' }], []] }] });
    const yCards = a.doc.getMap('storymap').get('slices').get(0).get('stories').get(a.state.columns[0].id);
    const [one, two, three] = yCards.toArray();
    const cards = a.state.slices[0].stories[a.state.columns[0].id];
    cards.push(cards.shift()); // One moves to the bottom
    a.yjs.syncToYjs();
    const after = yCards.toArray();
    assert.deepEqual(after.map(c => c.get('name')), ['Two', 'Three', 'One']);
    assert.equal(after[0], two);
    assert.equal(after[1], three);
    assert.notEqual(after[2], one, 'the moved card is a new copy');
  });

  test('a list with two copies of a card shows it once, and the next save removes the copy', async () => {
    const a = await makeClient();
    load(a, smallMap());
    const yCards = a.doc.getMap('storymap').get('slices').get(0).get('stories').get(a.state.columns[0].id);
    const copy = new Y.Map();
    copy.set('id', yCards.get(0).get('id'));
    copy.set('name', 'Stale copy');
    a.doc.transact(() => yCards.push([copy]), 'remote');
    a.yjs.syncFromYjs();
    assert.deepEqual(storyNames(a)[0], ['Email form']);
    a.state.name = 'Any change';
    a.yjs.syncToYjs();
    assert.deepEqual(yCards.toArray().map(c => c.get('name')), ['Email form']);
  });

  test('clearing a field removes it', async () => {
    const a = await makeClient();
    load(a, { ...smallMap(), steps: [{ name: 'Sign up', status: 'done', url: 'https://example.com' }, { name: 'Pay' }] });
    Object.assign(a.state.columns[0], { status: null, url: null });
    a.yjs.syncToYjs();
    assert.deepEqual(serverView(a.doc).steps[0], { name: 'Sign up' });
  });

  test('notes are only copied into an empty notepad', async () => {
    const a = await makeClient();
    load(a, { ...smallMap(), notes: 'First' });
    a.state.notes = 'Second';
    a.state.name = 'Changed so the save runs';
    a.yjs.syncToYjs();
    assert.equal(a.doc.getText('notes').toString(), 'First');
  });

  test('nothing is saved while the map is locked', async () => {
    const a = await makeClient();
    load(a, smallMap());
    a.state.mapId = 'abc12345';
    a.editable = false;
    a.state.name = 'Not saved';
    a.yjs.syncToYjs();
    assert.equal(a.doc.getMap('storymap').get('name'), 'Small');
  });
});

describe('reading from the shared document', () => {
  test('a map the server wrote arrives intact', async () => {
    const serverDoc = new Y.Doc();
    writeDocFromJson(serverDoc, fullMap(), Y);
    const a = await makeClient();
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(serverDoc), 'remote');
    a.yjs.syncFromYjs();
    assert.deepEqual(exported(a), fullMap());
  });

  test('reports no change when nothing changed', async () => {
    const a = await makeClient();
    load(a, smallMap());
    a.yjs.syncFromYjs();
    assert.equal(a.yjs.syncFromYjs(), false);
  });

  test('a document in the old format, with users and activities as slices, is read', async () => {
    const doc = new Y.Doc();
    const ymap = doc.getMap('storymap');
    const card = (id, name) => { const m = new Y.Map(); m.set('id', id); m.set('name', name); return m; };
    const cards = (...items) => { const arr = new Y.Array(); arr.push(items); return arr; };
    const slice = (id, name, rowType, colCards) => {
      const s = new Y.Map();
      s.set('id', id); s.set('name', name);
      if (rowType) s.set('rowType', rowType);
      const stories = new Y.Map();
      stories.set('col00001', colCards);
      s.set('stories', stories);
      return s;
    };
    const columns = new Y.Array();
    columns.push([card('col00001', 'Browse')]);
    ymap.set('columns', columns);
    const slices = new Y.Array();
    slices.push([
      slice('s1', '', 'Users', cards(card('u1', 'Guest'))),
      slice('s2', '', 'Activities', cards(card('a1', 'Find a drink'))),
      slice('s3', 'MVP', null, cards(card('t1', 'List drinks'))),
    ]);
    ymap.set('slices', slices);

    const a = await makeClient();
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(doc), 'remote');
    a.yjs.syncFromYjs();
    const out = exported(a);
    assert.deepEqual(out.users, [[{ name: 'Guest' }]]);
    assert.deepEqual(out.activities, [[{ name: 'Find a drink' }]]);
    assert.deepEqual(out.slices, [{ name: 'MVP', stories: [[{ name: 'List drinks' }]] }]);
  });
});

describe('two people editing the same map', () => {
  const twoClients = async (map = smallMap()) => {
    const a = await makeClient();
    const b = await makeClient();
    load(a, map);
    send(a, b);
    return { a, b };
  };

  test('the second person receives the map', async () => {
    const { b } = await twoClients(fullMap());
    assert.deepEqual(exported(b), fullMap());
  });

  test('edits to different cards both survive', async () => {
    const { a, b } = await twoClients();
    a.state.slices[0].stories[a.state.columns[0].id][0].name = 'Edited by A';
    b.state.users[b.state.columns[0].id][0].name = 'Edited by B';
    a.yjs.syncToYjs();
    b.yjs.syncToYjs();
    exchange(a, b);
    for (const client of [a, b]) {
      assert.equal(client.state.slices[0].stories[client.state.columns[0].id][0].name, 'Edited by A');
      assert.equal(client.state.users[client.state.columns[0].id][0].name, 'Edited by B');
    }
  });

  test('edits to different fields of the same card both survive', async () => {
    const { a, b } = await twoClients();
    a.state.slices[0].stories[a.state.columns[0].id][0].name = 'Renamed by A';
    b.state.slices[0].stories[b.state.columns[0].id][0].status = 'done';
    a.yjs.syncToYjs();
    b.yjs.syncToYjs();
    exchange(a, b);
    const card = b.state.slices[0].stories[b.state.columns[0].id][0];
    assert.equal(card.name, 'Renamed by A');
    assert.equal(card.status, 'done');
  });

  test('adding a card does not undo a rename of another card in the same column', async () => {
    const { a, b } = await twoClients();
    a.state.slices[0].stories[a.state.columns[0].id].push({ id: 'newcard1', name: 'Added by A', body: '', color: null, url: null, hidden: false, status: null, points: null, tags: [] });
    b.state.slices[0].stories[b.state.columns[0].id][0].name = 'Renamed by B';
    a.yjs.syncToYjs();
    b.yjs.syncToYjs();
    exchange(a, b);
    assert.deepEqual(storyNames(a)[0], ['Renamed by B', 'Added by A']);
    assert.deepEqual(storyNames(b), storyNames(a), 'both people see the same map');
  });

  test('two people adding a card to the same column do not duplicate the cards already there', async () => {
    const { a, b } = await twoClients();
    const blank = (id, name) => ({ id, name, body: '', color: null, url: null, hidden: false, status: null, points: null, tags: [] });
    a.state.slices[0].stories[a.state.columns[0].id].push(blank('cardfroma', 'From A'));
    b.state.slices[0].stories[b.state.columns[0].id].push(blank('cardfromb', 'From B'));
    a.yjs.syncToYjs();
    b.yjs.syncToYjs();
    exchange(a, b);
    const names = storyNames(a)[0];
    assert.equal(names.filter(n => n === 'Email form').length, 1, `Email form appears once: ${JSON.stringify(names)}`);
    assert.deepEqual([...names].sort(), ['Email form', 'From A', 'From B']);
    assert.deepEqual(storyNames(b), storyNames(a), 'both people see the same map');
  });

  test('two people reordering the same column do not duplicate its cards', async () => {
    const map = { ...smallMap(), slices: [{ name: 'MVP', stories: [[{ name: 'One' }, { name: 'Two' }, { name: 'Three' }], []] }] };
    const { a, b } = await twoClients(map);
    const colA = a.state.slices[0].stories[a.state.columns[0].id];
    const colB = b.state.slices[0].stories[b.state.columns[0].id];
    colA.unshift(colA.pop());              // A moves Three to the top
    colB.push(colB.shift());               // B moves One to the bottom
    a.yjs.syncToYjs();
    b.yjs.syncToYjs();
    exchange(a, b);
    const names = storyNames(a)[0];
    assert.deepEqual([...names].sort(), ['One', 'Three', 'Two'], `each card once: ${JSON.stringify(names)}`);
    assert.deepEqual(storyNames(b), storyNames(a), 'both people see the same map');
  });

  test('adding a slice does not undo an edit to a card', async () => {
    const { a, b } = await twoClients();
    a.state.slices.push({ id: 'slice002', name: 'Release 2', collapsed: false, stories: Object.fromEntries(a.state.columns.map(c => [c.id, []])) });
    b.state.slices[0].stories[b.state.columns[0].id][0].name = 'Edited by B';
    a.yjs.syncToYjs();
    b.yjs.syncToYjs();
    exchange(a, b);
    assert.deepEqual(a.state.slices.map(s => s.name), ['MVP', 'Release 2']);
    assert.equal(a.state.slices[0].stories[a.state.columns[0].id][0].name, 'Edited by B');
    assert.deepEqual(exported(b), exported(a), 'both people see the same map');
  });

  test('two people adding a slice at once do not duplicate the slices already there', async () => {
    const { a, b } = await twoClients();
    const newSlice = (client, id, name) => ({ id, name, collapsed: false, stories: Object.fromEntries(client.state.columns.map(c => [c.id, []])) });
    a.state.slices.push(newSlice(a, 'slicefra', 'From A'));
    b.state.slices.push(newSlice(b, 'slicefrb', 'From B'));
    a.yjs.syncToYjs();
    b.yjs.syncToYjs();
    exchange(a, b);
    assert.deepEqual([...a.state.slices.map(s => s.name)].sort(), ['From A', 'From B', 'MVP']);
    assert.deepEqual(exported(b), exported(a), 'both people see the same map');
  });

  test('adding a step does not undo an edit to a card', async () => {
    const { a, b } = await twoClients();
    a.state.columns.push({ id: 'colnew01', name: 'Receipt', body: '', color: null, url: null, hidden: false, status: null, points: null, tags: [] });
    a.state.users.colnew01 = [];
    a.state.activities.colnew01 = [];
    a.state.slices.forEach(s => { s.stories.colnew01 = []; });
    b.state.slices[0].stories[b.state.columns[0].id][0].name = 'Edited by B';
    a.yjs.syncToYjs();
    b.yjs.syncToYjs();
    exchange(a, b);
    assert.deepEqual(a.state.columns.map(c => c.name), ['Sign up', 'Pay', 'Receipt']);
    assert.equal(a.state.slices[0].stories[a.state.columns[0].id][0].name, 'Edited by B');
  });

  test('a renamed slice and an edited card in it both survive', async () => {
    const { a, b } = await twoClients();
    a.state.slices[0].name = 'Release 1';
    b.state.slices[0].stories[b.state.columns[0].id][0].name = 'Edited by B';
    a.yjs.syncToYjs();
    b.yjs.syncToYjs();
    exchange(a, b);
    assert.equal(b.state.slices[0].name, 'Release 1');
    assert.equal(a.state.slices[0].stories[a.state.columns[0].id][0].name, 'Edited by B');
  });

  test('a change from the other person renders at once, and changes within 100ms render together after', async () => {
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const receive = (from, to) => Y.applyUpdate(to.doc, Y.encodeStateAsUpdate(from.doc, Y.encodeStateVector(to.doc)), 'remote');
    const { a, b } = await twoClients();
    await wait(150); // let the render from receiving the map finish

    a.state.name = 'First';
    a.yjs.syncToYjs();
    receive(a, b);
    assert.equal(b.state.name, 'First', 'rendered at once');
    const renders = b.renders;

    a.state.name = 'Second';
    a.yjs.syncToYjs();
    receive(a, b);
    assert.equal(b.state.name, 'First', 'held back');
    await wait(150);
    assert.equal(b.state.name, 'Second', 'rendered after the pause');
    assert.equal(b.renders, renders + 1);
  });
});
