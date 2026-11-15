import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { DETAILS, loadDetails, saveDetail } from '/src/transfer/tracker-details.js';

// A stand-in for the browser's local storage
const fakeStorage = (initial = {}) => {
  const items = { ...initial };
  return {
    items,
    getItem: (key) => (key in items ? items[key] : null),
    setItem: (key, value) => { items[key] = String(value); },
    removeItem: (key) => { delete items[key]; },
  };
};

describe('remembered tracker details', () => {
  const page = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf-8');
  const ids = Object.values(DETAILS).flat();

  test('every remembered field is on the page', () => {
    assert.deepEqual(ids.filter(id => !page.includes(`id="${id}"`)), []);
  });

  test('no token, key or password field is ever remembered', () => {
    assert.deepEqual(ids.filter(id => /token|apikey|password|secret/i.test(id)), []);
    for (const id of ids) {
      const tag = page.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))[0];
      assert.doesNotMatch(tag, /type="password"/, id);
    }
    // And every password field on the page is left out
    const passwords = [...page.matchAll(/<input[^>]*type="password"[^>]*>/g)].map(m => m[0].match(/id="([^"]+)"/)[1]);
    assert.ok(passwords.length >= 8);
    assert.deepEqual(passwords.filter(id => ids.includes(id)), []);
    assert.equal(ids.includes('phabApiToken'), false, 'the console token is a plain text field, and is left out too');
  });

  test('saves a detail, trimmed, and reads it back', () => {
    const storage = fakeStorage();
    saveDetail('jira.instanceUrl', '  acme.atlassian.net ', storage);
    saveDetail('jira.email', 'me@example.com', storage);
    assert.deepEqual(loadDetails(storage), { 'jira.instanceUrl': 'acme.atlassian.net', 'jira.email': 'me@example.com' });
  });

  test('an emptied field forgets its detail, and nothing is left behind when all are gone', () => {
    const storage = fakeStorage();
    saveDetail('linear.teamKey', 'ENG', storage);
    saveDetail('linear.teamKey', '', storage);
    assert.deepEqual(loadDetails(storage), {});
    assert.deepEqual(storage.items, {});
  });

  test('a detail that is not on the list is never saved or read', () => {
    const storage = fakeStorage({ trackerDetails: JSON.stringify({ 'jira.token': 'secret', 'jira.email': 'me@example.com', 'linear.teamKey': 5 }) });
    assert.deepEqual(loadDetails(storage), { 'jira.email': 'me@example.com' });
    saveDetail('jira.token', 'secret', storage);
    assert.equal(storage.items.trackerDetails.includes('secret'), true, 'the junk is only dropped on the next save');
    saveDetail('jira.email', 'you@example.com', storage);
    assert.equal(storage.items.trackerDetails, JSON.stringify({ 'jira.email': 'you@example.com' }));
  });

  test('storage that is off or holds junk remembers nothing and does not throw', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => {} };
    assert.deepEqual(loadDetails(broken), {});
    assert.doesNotThrow(() => saveDetail('jira.email', 'me@example.com', broken));
    assert.deepEqual(loadDetails(fakeStorage({ trackerDetails: 'not json' })), {});
    assert.deepEqual(loadDetails(fakeStorage({ trackerDetails: '[1,2]' })), {});
  });
});
