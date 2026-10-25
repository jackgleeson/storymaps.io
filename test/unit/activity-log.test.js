import { describe, test, beforeEach, afterEach, mock } from 'node:test';
import { strict as assert } from 'node:assert';
import * as Y from 'yjs';

// The log renders into the Log panel. Stand in for the page with fake elements that record
// what's written to them.
const fakeElement = (tag) => {
  const el = {
    tag, className: '', textContent: '', title: '', children: [],
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(html) { this._html = html; this.children = []; },
    classList: { add(c) { el.className += ` ${c}`; } },
    addEventListener() {},
    append(...kids) { this.children.push(...kids); },
    appendChild(kid) { this.children.push(kid); },
  };
  return el;
};
const logList = fakeElement('div');
const logStats = fakeElement('div');
globalThis.document = {
  getElementById: (id) => ({ logList, logStats })[id] ?? null,
  createElement: fakeElement,
  querySelectorAll: () => [],
};
globalThis.window = { location: { hostname: 'storymaps.io' }, matchMedia: () => ({ matches: false }) };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.sessionStorage = {};

const log = await import('/src/core/log.js');
const { getSessionId } = await import('/src/ui/presence.js');
log.init();

let doc;
beforeEach(() => {
  doc = new Y.Doc();
  log.bindYjs(doc);
});
afterEach(() => log.unbindYjs());

const entries = () => doc.getArray('log').toArray();
// The text of each rendered row, newest first
const rows = () => logList.children.map(row => row.innerHTML.match(/<span class="log-text">(.*)<\/span>$/)?.[1]);

describe('logging', () => {
  test('an event is added with the time, source, session, name and the cards it touched', () => {
    log.logEvent('Added card "Pay"', ['card0001']);
    const [entry] = entries();
    assert.equal(entry.text, 'Added card "Pay"');
    assert.equal(entry.src, 'web');
    assert.equal(entry.sid, getSessionId());
    assert.equal(entry.name, 'guest');
    assert.deepEqual(entry.ids, ['card0001']);
    assert.ok(Math.abs(entry.ts - Date.now()) < 1000);
  });

  test('keeps only the latest 20 events', () => {
    for (let i = 1; i <= 25; i++) log.logEvent(`Event ${i}`);
    const texts = entries().map(e => e.text);
    assert.equal(texts.length, 20);
    assert.equal(texts[0], 'Event 6');
    assert.equal(texts[19], 'Event 25');
  });

  test('nothing is logged before a map is open', () => {
    log.unbindYjs();
    log.logEvent('Lost');
    log.bindYjs(doc);
    assert.deepEqual(entries(), []);
  });

  test('quoted adds a quoted name, cut to 30 characters', () => {
    assert.equal(log.quoted('Pay'), ' "Pay"');
    assert.equal(log.quoted('x'.repeat(40)), ` "${'x'.repeat(30)}..."`);
    assert.equal(log.quoted(''), '');
  });
});

describe('typing', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
  afterEach(() => mock.timers.reset());

  test('a burst of typing is logged once, 2 seconds after it stops', () => {
    log.logTextEdit('card name', 'card0001');
    mock.timers.tick(1500);
    log.logTextEdit('card name', 'card0001');
    mock.timers.tick(1999);
    assert.deepEqual(entries(), []);
    mock.timers.tick(1);
    assert.deepEqual(entries().map(e => [e.text, e.ids]), [['Edited card name', ['card0001']]]);
  });

  test('moving on to another card logs the first edit straight away', () => {
    log.logTextEdit('card name', 'card0001');
    mock.timers.tick(500);
    log.logTextEdit('card name', 'card0002');
    assert.deepEqual(entries().map(e => [e.text, e.ids]), [['Edited card name', ['card0001']]]);
    mock.timers.tick(2000);
    assert.deepEqual(entries().map(e => e.ids[0]), ['card0001', 'card0002']);
  });

  test('editing the title and then the body of a card logs both', () => {
    log.logTextEdit('card title', 'card0001');
    log.logTextEdit('card body', 'card0001');
    mock.timers.tick(2000);
    assert.deepEqual(entries().map(e => e.text), ['Edited card title', 'Edited card body']);
  });

  test('an edit pending when the map is closed is logged in that map, not the next one', () => {
    log.logTextEdit('card name', 'card0001');
    const first = doc;
    log.unbindYjs();
    doc = new Y.Doc();
    log.bindYjs(doc);
    mock.timers.tick(2000);
    assert.deepEqual(first.getArray('log').toArray().map(e => e.text), ['Edited card name']);
    assert.deepEqual(entries(), []);
  });
});

describe('the Log panel', () => {
  test('lists events newest first, naming who made them', () => {
    const otherDoc = doc.getArray('log');
    otherDoc.push([
      { ts: Date.now(), src: 'web', text: 'Added step', sid: 'someone-else', name: 'Sam', ids: [] },
      { ts: Date.now(), src: 'cli', text: 'Renamed map', sid: '', ids: [] },
    ]);
    log.logEvent('Deleted card');
    assert.deepEqual(rows(), ['You: Deleted card', 'Renamed map', 'Sam: Added step']);
  });

  test('says when there is no activity', () => {
    log.logEvent('One');
    doc.getArray('log').delete(0, 1);
    assert.match(logList.innerHTML, /No activity yet/);
  });

  test('HTML in an event or a name from another person is shown as text, not run', () => {
    doc.getArray('log').push([{ ts: Date.now(), src: 'web', text: '<img src=x onerror=alert(1)>', sid: 'x', name: '<b>Mallory</b>', ids: [] }]);
    const [row] = logList.children;
    assert.ok(!row.innerHTML.includes('<img'), row.innerHTML);
    assert.ok(!row.innerHTML.includes('<b>'), row.innerHTML);
    assert.match(row.innerHTML, /&lt;b&gt;Mallory&lt;\/b&gt;: &lt;img src=x onerror=alert\(1\)&gt;/);
  });

  test('a session ID that is not a real ID cannot inject a colour', () => {
    doc.getArray('log').push([{ ts: Date.now(), src: 'web', text: 'x', sid: 'red;background:url(evil)', ids: [] }]);
    assert.match(logList.children[0].innerHTML, /style="background:#888"/);
  });

  test('the header lists recent contributors, newest first', () => {
    doc.getArray('log').push([
      { ts: Date.now() - 60_000, src: 'web', text: 'a', sid: 's1', name: 'Sam', ids: [] },
      { ts: Date.now(), src: 'cli', text: 'b', sid: '', ids: [] },
    ]);
    const list = logStats.children[0];
    const pairs = [];
    for (let i = 0; i < list.children.length; i += 2) pairs.push([list.children[i].textContent, list.children[i + 1].textContent]);
    assert.deepEqual(pairs, [['Last edited', 'just now'], ['Recent', 'CLI, Sam']]);
  });
});
