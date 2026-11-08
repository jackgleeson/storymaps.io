import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { arrivalHook, clickEvent, CLICKS } from '../../src/features/analytics.js';
import { readFileSync } from 'node:fs';

test('the first hit uses the address the visitor arrived on, without a slice or card link', () => {
  const hook = arrivalHook('https://storymaps.io/abc12345#card-k3m9qz1a');
  assert.deepEqual(hook('event', { website: 'w', url: 'https://storymaps.io/other' }), { website: 'w', url: 'https://storymaps.io/abc12345' });
});

test('a named action leaves the arrival address for the page view', () => {
  const hook = arrivalHook('https://storymaps.io/tour');
  const action = { name: 'tour-started', url: 'https://storymaps.io/newmap12' };
  assert.equal(hook('event', action), action);
  assert.equal(hook('event', { url: 'https://storymaps.io/newmap12' }).url, 'https://storymaps.io/tour');
});

test('later hits are left as they are', () => {
  const hook = arrivalHook('https://storymaps.io/tour');
  hook('event', { url: 'https://storymaps.io/newmap12' });
  const later = { url: 'https://storymaps.io/another1', referrer: '/tour' };
  assert.equal(hook('event', later), later);
});

// An element that matches only the given selector, and is its own closest match
const button = (selector, { text = '', dataset = {} } = {}) => {
  const el = { textContent: text, dataset, closest: (s) => (s.split(', ').includes(selector) ? el : null) };
  return el;
};

test('a tracked button gives its event, and anything else gives nothing', () => {
  assert.equal(clickEvent(button('#importJiraBtn')), 'import-jira');
  assert.equal(clickEvent(button('#exportCsvDownloadBtn')), 'export-csv');
  assert.equal(clickEvent(button('#buildAiBtn')), 'build-with-ai');
  assert.equal(clickEvent(button('#recentMapsBtn')), 'recent-maps-homepage');
  assert.equal(clickEvent(button('a.recent-menu-item')), 'recent-map-opened-menu');
  assert.equal(clickEvent(button('#somethingElse')), null);
  assert.equal(clickEvent({}), null, 'a click on something with no closest');
});

test('home page imports and samples are named after the button', () => {
  assert.equal(clickEvent(button('[data-import]', { dataset: { import: 'linear' } })), 'import-linear-homepage');
  assert.equal(clickEvent(button('[data-sample]', { dataset: { sample: 'recipe-app' } })), 'sample-recipe-app');
});

test('a button shared by several actions only counts for the one in the table', () => {
  assert.equal(clickEvent(button('#lockModalConfirm', { text: 'Lock Map' })), 'map-locked');
  assert.equal(clickEvent(button('#lockModalConfirm', { text: 'Unlock' })), null);
  assert.equal(clickEvent(button('.tour-btn-next', { text: 'Next' })), null);
  assert.equal(clickEvent(button('.tour-btn-next', { text: ' Finish ' })), 'tour-finished');
  assert.equal(clickEvent(button('.project-panel-primary', { text: 'New map' })), null);
  assert.equal(clickEvent(button('.project-panel-primary', { text: 'Create project with 2 maps' })), 'project-created');
  assert.equal(clickEvent(button('.canvas-context-menu button', { text: 'Copy link to slice' })), 'slice-link-copied');
  assert.equal(clickEvent(button('.canvas-context-menu button', { text: 'Delete column' })), null);
});

test('every button the table names by ID is on the page', () => {
  const page = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf-8');
  const ids = CLICKS.flatMap(([selector]) => selector.split(', ')).filter(s => s.startsWith('#')).map(s => s.slice(1));
  assert.ok(ids.length > 30);
  assert.deepEqual(ids.filter(id => !page.includes(`id="${id}"`)), []);
});
