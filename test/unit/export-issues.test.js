import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  labelSlug, collectCards, isTaskCard, cardLabels, issueDescription, toIssue, jiraCsv, asanaCsv,
  phabConsoleFunction, phabConsoleCall, parsePhabTags, extractAsanaProjectGid,
} from '/src/transfer/export-issues.js';
import { parseCsv } from '/src/transfer/csv.js';

// A story map as the app holds it: steps are columns, and each slice keeps its cards by column
const card = (id, name, extra = {}) => ({ id, name, body: '', status: null, points: null, color: null, tags: [], ...extra });
const map = () => ({
  columns: [{ id: 'c1', name: 'Browse Menu' }, { id: 'c2', name: 'Pay' }, { id: 'c3', name: '' }],
  slices: [
    { id: 's1', name: 'MVP', stories: {
      c1: [card('a', 'Drink list', { status: 'done', tags: ['frontend', 'Back End'], body: 'Every drink with its price.' })],
      c2: [card('b', 'Card payment', { status: 'in-progress', points: 3 }), card('blank', '   ')],
    } },
    { id: 's2', name: 'V1', stories: { c1: [card('c', 'Photos', { status: 'blocked' })], c3: [card('d', 'Loose end')] } },
  ],
});

describe('collectCards', () => {
  test('lists every named card, release by release, then step by step', () => {
    assert.deepEqual(collectCards(map()).map(c => [c.name, c.sliceName, c.stepName, c.status]), [
      ['Drink list', 'MVP', 'Browse Menu', 'done'],
      ['Card payment', 'MVP', 'Pay', 'in-progress'],
      ['Photos', 'V1', 'Browse Menu', 'blocked'],
      ['Loose end', 'V1', '', 'none'],
    ]);
  });

  test('keeps only the ticked releases and statuses', () => {
    assert.deepEqual(collectCards(map(), { sliceIds: new Set(['s2']) }).map(c => c.name), ['Photos', 'Loose end']);
    assert.deepEqual(collectCards(map(), { statuses: new Set(['done', 'none']) }).map(c => c.name), ['Drink list', 'Loose end']);
  });
});

describe('task cards', () => {
  test('a card is a task card when it is yellow, has no colour of its own, or has a status', () => {
    assert.ok(isTaskCard(card('a', 'Plain')));
    assert.ok(isTaskCard(card('b', 'Yellow', { color: '#FEF08A' })));
    assert.ok(isTaskCard(card('c', 'Lime, in progress', { color: '#bef264', status: 'in-progress' })));
    assert.equal(isTaskCard(card('d', 'A question', { color: '#bef264' })), false);
    assert.equal(isTaskCard(card('e', 'A note', { color: '#a5f3fc', status: null })), false);
  });

  test('tasksOnly leaves out cards of other colours that have no status', () => {
    const coloured = map();
    coloured.slices[0].stories.c1.push(card('q', 'Do we need photos?', { color: '#bef264' }));
    coloured.slices[1].stories.c1.push(card('n', 'Too slow on 3G', { color: '#fecdd3' }), card('w', 'Fix the queue', { color: '#fecdd3', status: 'planned' }));
    assert.deepEqual(collectCards(coloured).map(c => c.name), ['Drink list', 'Do we need photos?', 'Card payment', 'Photos', 'Too slow on 3G', 'Fix the queue', 'Loose end']);
    assert.deepEqual(collectCards(coloured, { tasksOnly: true }).map(c => c.name), ['Drink list', 'Card payment', 'Photos', 'Fix the queue', 'Loose end']);
  });
});

describe('labels', () => {
  const [drinks, , , loose] = collectCards(map());

  test('are lower case with hyphens, so Jira accepts them', () => {
    assert.equal(labelSlug('  Browse  Menu '), 'browse-menu');
    assert.equal(labelSlug(null), '');
  });

  test('a card carries its slice, its step and its own tags', () => {
    assert.deepEqual(cardLabels(drinks), [
      { kind: 'slice', name: 'mvp' }, { kind: 'step', name: 'browse-menu' },
      { kind: 'tag', name: 'frontend' }, { kind: 'tag', name: 'back-end' },
    ]);
  });

  test('each kind can be left out', () => {
    assert.deepEqual(cardLabels(drinks, { slice: false, tags: false }).map(l => l.name), ['browse-menu']);
  });

  test('a step with no name gives no label, and a repeated label is kept once', () => {
    assert.deepEqual(cardLabels(loose).map(l => l.name), ['v1']);
    assert.deepEqual(cardLabels({ sliceName: 'Pay', stepName: 'pay', tags: ['PAY'] }).map(l => l.name), ['pay']);
  });
});

describe('issues', () => {
  const [drinks, payment, , loose] = collectCards(map());
  const link = 'https://storymaps.io/abc#card-a';

  test('the description is the card text, then where the card sat and a link back', () => {
    assert.equal(issueDescription(drinks, { link }), 'Every drink with its price.\n\nSlice: MVP\nStep: Browse Menu\nStory map: https://storymaps.io/abc#card-a');
    assert.equal(issueDescription(loose, { link }), 'Slice: V1\nStory map: https://storymaps.io/abc#card-a');
  });

  test('trackers without labels get the tags as a line too', () => {
    assert.match(issueDescription(drinks, { tagsLine: true }), /\nTags: frontend, Back End$/);
  });

  test('one issue per card, with its labels, status and points', () => {
    assert.deepEqual(toIssue(payment, { link }), {
      title: 'Card payment', description: 'Slice: MVP\nStep: Pay\nStory map: https://storymaps.io/abc#card-a',
      status: 'in-progress', labels: ['mvp', 'pay'], points: 3,
    });
    assert.deepEqual(toIssue(drinks, { labelOptions: null }).labels, []);
    assert.equal('points' in toIssue(drinks), false);
  });
});

describe('Jira CSV', () => {
  const issues = collectCards(map()).map(c => toIssue(c, { link: `https://storymaps.io/abc#card-${c.id}` }));
  const statusNames = { none: 'To Do', planned: 'To Do', 'in-progress': 'In Progress', blocked: 'On Hold', done: 'Done' };

  test('one Story row per card, with a Labels column for each label and no parents', () => {
    const rows = parseCsv(jiraCsv(issues, { statusNames }));
    assert.deepEqual(rows[0], ['Work type', 'Summary', 'Description', 'Status', 'Project type', 'Labels', 'Labels', 'Labels', 'Labels']);
    assert.equal(rows.length, 5);
    assert.deepEqual(rows[1], ['Story', 'Drink list', 'Every drink with its price.\n\nSlice: MVP\nStep: Browse Menu\nStory map: https://storymaps.io/abc#card-a', 'Done', 'software', 'mvp', 'browse-menu', 'frontend', 'back-end']);
    assert.deepEqual(rows[2].slice(3), ['In Progress', 'software', 'mvp', 'pay', '', '']);
    assert.deepEqual(rows[3].slice(0, 4), ['Story', 'Photos', 'Slice: V1\nStep: Browse Menu\nStory map: https://storymaps.io/abc#card-c', 'On Hold']);
  });

  test('adds the project columns when a name and key are given', () => {
    const rows = parseCsv(jiraCsv(issues.slice(0, 1), { projectName: 'Coffee', projectKey: 'COF', projectType: 'business', statusNames }));
    assert.deepEqual(rows[0].slice(0, 3), ['Project name', 'Project key', 'Work type']);
    assert.deepEqual([rows[1][0], rows[1][1], rows[1][6]], ['Coffee', 'COF', 'business']);
  });

  test('with no labels there are no Labels columns', () => {
    const plain = collectCards(map()).map(c => toIssue(c, { labelOptions: { slice: false, step: false, tags: false } }));
    assert.deepEqual(parseCsv(jiraCsv(plain, { statusNames }))[0], ['Work type', 'Summary', 'Description', 'Status', 'Project type']);
  });
});

describe('Asana CSV', () => {
  const cards = collectCards(map());
  const link = (c) => `https://storymaps.io/abc#card-${c.id}`;

  test('one row per card, with the slice, the step and the tags in columns of their own', () => {
    const rows = parseCsv(asanaCsv(cards, { link }));
    assert.deepEqual(rows[0], ['Name', 'Description', 'Slice', 'Step', 'Tags']);
    assert.deepEqual(rows[1], ['Drink list', 'Every drink with its price.\n\nSlice: MVP\nStep: Browse Menu\nStory map: https://storymaps.io/abc#card-a', 'MVP', 'Browse Menu', 'frontend, Back End']);
    assert.deepEqual(rows[4].slice(2), ['V1', '', '']);
  });

  test('a column that is unticked is left out', () => {
    assert.deepEqual(parseCsv(asanaCsv(cards, { link, slice: false, tags: false }))[0], ['Name', 'Description', 'Step']);
  });
});

describe('Phabricator console export', () => {
  const issues = collectCards(map()).map(c => toIssue(c, { labelOptions: null, tagsLine: true }));

  test('the call lists one task per card with its Phabricator status', () => {
    const call = phabConsoleCall('api-123', issues, ['shop']);
    assert.match(call, /^importTasks\("api-123", \[/);
    const tasks = JSON.parse(call.slice(call.indexOf('['), call.lastIndexOf(', [')));
    assert.deepEqual(tasks.map(t => [t.title, t.status]), [['Drink list', 'resolved'], ['Card payment', 'progress'], ['Photos', 'stalled'], ['Loose end', 'open']]);
    assert.match(tasks[0].description, /Slice: MVP\nStep: Browse Menu\nTags: frontend, Back End$/);
    assert.ok(call.endsWith(', ["shop"]);'));
  });

  test('the function posts to the Phabricator site, with no epics or subtasks', () => {
    const fn = phabConsoleFunction('https://phab.example.org');
    assert.match(fn, /https:\/\/phab\.example\.org\/api\/maniphest\.edit/);
    assert.doesNotMatch(fn, /epic|parent|subtask/i);
    assert.doesNotThrow(() => new Function(`${fn}; return importTasks;`));
  });

  test('tags are split on commas and made into slugs', () => {
    assert.deepEqual(parsePhabTags(' Shop Team, checkout ,, '), ['shop-team', 'checkout']);
  });
});

test('the Asana project ID is read from either kind of project link', () => {
  assert.equal(extractAsanaProjectGid('https://app.asana.com/1/123/project/456789/list/1'), '456789');
  assert.equal(extractAsanaProjectGid('https://app.asana.com/0/456789/list'), '456789');
  assert.equal(extractAsanaProjectGid('456789'), '456789');
  assert.equal(extractAsanaProjectGid('not a link'), '');
});
