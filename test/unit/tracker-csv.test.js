import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';

// The import modules also hold the import dialogs; stub the page so they load
globalThis.document ??= { getElementById: () => null };
globalThis.window ??= { location: { hostname: 'storymaps.io' } };
globalThis.location ??= { hostname: 'storymaps.io' };

const { parseJiraCsv } = await import('/src/transfer/jira-imports.js');
const { parseAsanaCsv } = await import('/src/transfer/asana-imports.js');
const { parseLinearCsv } = await import('/src/transfer/linear-imports.js');
const { parsePhabricatorCsv } = await import('/src/transfer/phabricator-imports.js');

const csv = (...rows) => rows.map(r => r.join(',')).join('\n');

describe('Jira CSV', () => {
  const header = ['Summary', 'Issue key', 'Issue Type', 'Status', 'Description', 'Custom field (Story Points)', 'Parent key', 'Project key'];

  test('groups stories under their epics, in file order', () => {
    const { epics, projectKey } = parseJiraCsv(csv(
      header,
      ['Checkout', 'SHOP-1', 'Epic', 'In Progress', 'Paying', '', '', 'SHOP'],
      ['Card payment', 'SHOP-2', 'Story', 'Done', '"Visa, Mastercard"', '3', 'SHOP-1', 'SHOP'],
      ['Receipts', 'SHOP-3', 'Story', 'To Do', '', '', 'SHOP-1', 'SHOP'],
    ));
    assert.equal(projectKey, 'SHOP');
    assert.equal(epics.length, 1);
    assert.equal(epics[0].summary, 'Checkout');
    assert.deepEqual(epics[0].stories, [
      { key: 'SHOP-2', summary: 'Card payment', status: 'done', description: 'Visa, Mastercard', points: 3, labels: [] },
      { key: 'SHOP-3', summary: 'Receipts', status: 'planned', description: undefined, points: undefined, labels: [] },
    ]);
  });

  test('an epic keeps its status and description, as it does in the API import', () => {
    const { epics } = parseJiraCsv(csv(header, ['Checkout', 'SHOP-1', 'Epic', 'In Progress', 'Paying for an order', '', '', 'SHOP']));
    assert.equal(epics[0].status, 'in-progress');
    assert.equal(epics[0].description, 'Paying for an order');
  });

  test('reads every Labels column', () => {
    const { epics } = parseJiraCsv(csv(['Summary', 'Issue key', 'Issue Type', 'Labels', 'Labels', 'Labels'], ['Card', 'A-1', 'Story', 'payments', 'web', '']));
    assert.deepEqual(epics[0].stories[0].labels, ['payments', 'web']);
  });

  test('stories without an epic go into an Other group', () => {
    const { epics } = parseJiraCsv(csv(header, ['Loose', 'SHOP-9', 'Task', '', '', '', '', 'SHOP']));
    assert.deepEqual(epics.map(e => [e.key, e.summary]), [[null, 'Other (no parent epic)']]);
    assert.equal(epics[0].stories[0].summary, 'Loose');
  });

  test('maps statuses', () => {
    const statuses = ['Done', 'Closed', 'Resolved', 'In Progress', 'In Review', 'In Development', 'To Do', 'Backlog', ''];
    const { epics } = parseJiraCsv(csv(header, ...statuses.map((s, i) => [`S${i}`, `X-${i}`, 'Story', s, '', '', '', 'X'])));
    assert.deepEqual(epics[0].stories.map(s => s.status), ['done', 'done', 'done', 'in-progress', 'in-progress', 'in-progress', 'planned', 'planned', 'planned']);
  });

  test('takes the project key from the issue key when there is no project column', () => {
    const { projectKey } = parseJiraCsv(csv(['Summary', 'Issue key', 'Issue Type'], ['A', 'ABC-1', 'Story']));
    assert.equal(projectKey, 'ABC');
  });

  test('reads "Parent" when there is no "Parent key" column', () => {
    const { epics } = parseJiraCsv(csv(['Summary', 'Issue key', 'Issue Type', 'Parent'], ['E', 'A-1', 'Epic', ''], ['S', 'A-2', 'Story', 'A-1']));
    assert.deepEqual(epics[0].stories.map(s => s.key), ['A-2']);
  });

  test('skips rows without an issue key', () => {
    const { epics } = parseJiraCsv(csv(['Summary', 'Issue key', 'Issue Type'], ['No key', '', 'Story'], ['Has key', 'A-1', 'Story']));
    assert.deepEqual(epics[0].stories.map(s => s.summary), ['Has key']);
  });

  test('needs Summary, Issue key and Issue Type columns', () => {
    assert.throws(() => parseJiraCsv(csv(['Summary', 'Status'], ['A', 'Done'])), /Missing required columns/);
  });

  test('a file with only a header has nothing to import', () => {
    assert.deepEqual(parseJiraCsv(csv(header)), { epics: [], projectKey: '' });
  });
});

describe('Asana CSV', () => {
  const header = ['Task ID', 'Name', 'Section/Column', 'Completed At', 'Notes', 'Parent Task'];

  test('top-level tasks become groups and subtasks go under them', () => {
    const { epics, sections } = parseAsanaCsv(csv(
      header,
      ['1', 'Checkout', 'Doing', '', 'Paying', ''],
      ['2', 'Card payment', '', '2026-01-02', '', 'Checkout'],
      ['3', 'Search', 'To do', '', '', ''],
    ));
    assert.deepEqual(epics.map(e => [e.key, e.summary, e.sectionName]), [['1', 'Checkout', 'Doing'], ['3', 'Search', 'To do']]);
    assert.equal(epics[0].description, 'Paying');
    assert.deepEqual(epics[0].stories, [{ key: '2', summary: 'Card payment', status: 'done', description: undefined }]);
    assert.deepEqual(sections.map(s => s.name), ['Doing', 'To do']);
  });

  test('a completed date means done', () => {
    const { epics } = parseAsanaCsv(csv(header, ['1', 'Finished', '', '2026-01-02', '', ''], ['2', 'Open', '', '', '', '']));
    assert.deepEqual(epics.map(e => e.status), ['done', 'planned']);
  });

  test('two top-level tasks with the same name are both kept', () => {
    const { epics } = parseAsanaCsv(csv(header, ['1', 'Research', 'Q1', '', '', ''], ['2', 'Research', 'Q2', '', '', '']));
    assert.deepEqual(epics.map(e => e.key), ['1', '2']);
  });

  test('a subtask whose parent name is shared goes under the first task with that name', () => {
    const { epics } = parseAsanaCsv(csv(header, ['1', 'Research', '', '', '', ''], ['2', 'Research', '', '', '', ''], ['3', 'Interviews', '', '', '', 'Research']));
    assert.deepEqual(epics.map(e => e.stories.map(s => s.summary)), [['Interviews'], []]);
  });

  test('a subtask whose parent is not in the file is left out', () => {
    const { epics } = parseAsanaCsv(csv(header, ['1', 'Kept', '', '', '', ''], ['2', 'Orphan', '', '', '', 'Elsewhere']));
    assert.deepEqual(epics.map(e => [e.summary, e.stories.length]), [['Kept', 0]]);
  });

  test('needs a Name column', () => {
    assert.throws(() => parseAsanaCsv(csv(['Title'], ['A'])), /Missing required column: Name/);
  });
});

describe('Linear CSV', () => {
  const header = ['ID', 'Title', 'Description', 'Status', 'Estimate', 'Labels', 'Project', 'Parent issue', 'Completed'];

  test('reads issues with their status, points, labels, project and parent', () => {
    const { issues, projects, teamKey } = parseLinearCsv(csv(
      header,
      ['ENG-1', 'Checkout', '', 'In Progress', '5', '"web, payments"', 'Shop', '', ''],
      ['ENG-2', 'Card payment', 'Visa', 'Todo', '0', '', 'Shop', 'ENG-1', ''],
    ));
    assert.equal(teamKey, 'ENG');
    assert.deepEqual(projects.map(p => p.name), ['Shop']);
    const [parent, child] = issues;
    assert.equal(parent.status, 'in-progress');
    assert.equal(parent.points, 5);
    assert.deepEqual(parent.labels, ['web', 'payments']);
    assert.equal(parent.hasChildren, true);
    assert.equal(child.parentId, 'ENG-1');
    assert.equal(child.points, 0);
    assert.equal(child.description, 'Visa');
  });

  test('maps statuses, and a completed date always means done', () => {
    const rows = [['Done', ''], ['Canceled', ''], ['In Review', ''], ['Backlog', ''], ['Backlog', '2026-01-01']];
    const { issues } = parseLinearCsv(csv(header, ...rows.map(([status, completed], i) => [`E-${i}`, `T${i}`, '', status, '', '', '', '', completed])));
    assert.deepEqual(issues.map(i => i.status), ['done', 'done', 'in-progress', 'planned', 'done']);
  });

  test('needs a Title column', () => {
    assert.throws(() => parseLinearCsv(csv(['Name'], ['A'])), /Missing required column: Title/);
  });
});

describe('Phabricator CSV', () => {
  const header = ['ID', 'Monogram', 'Title', 'Description', 'Status', 'Points', 'Final Story Points', 'URI'];

  test('reads tasks with their key, status, points and site', () => {
    const { epics, baseUrl } = parsePhabricatorCsv(csv(
      header,
      ['101', 'T101', 'Login', 'Desc', 'Open', '2', '', 'https://phabricator.example.org/T101'],
      ['102', '', 'Logout', '', 'Resolved', '2', '3', ''],
    ));
    assert.equal(baseUrl, 'https://phabricator.example.org');
    const stories = epics.flatMap(e => e.stories);
    assert.deepEqual(stories.map(s => [s.key, s.status, s.points]), [['T101', 'planned', 2], ['T102', 'done', 3]]);
  });

  test('maps statuses', () => {
    const statuses = ['Open', 'Stalled', 'In Progress', 'Resolved', 'Declined', 'Invalid'];
    const { epics } = parsePhabricatorCsv(csv(header, ...statuses.map((s, i) => [String(i), '', `T${i}`, '', s, '', '', ''])));
    assert.deepEqual(epics.flatMap(e => e.stories).map(s => s.status), ['planned', 'planned', 'in-progress', 'done', 'done', 'done']);
  });

  test('spreads tasks over at most 8 columns', () => {
    const rows = Array.from({ length: 10 }, (_, i) => [String(i), '', `Task ${i}`, '', 'Open', '', '', '']);
    const { epics } = parsePhabricatorCsv(csv(header, ...rows));
    assert.equal(epics.length, 8);
    assert.deepEqual(epics[0].stories.map(s => s.summary), ['Task 0', 'Task 8']);
  });

  test('needs a Title column', () => {
    assert.throws(() => parsePhabricatorCsv(csv(['Name'], ['A'])), /Missing required column: Title/);
  });
});
