import { describe, test, beforeEach, afterEach, mock } from 'node:test';
import { strict as assert } from 'node:assert';

delete process.env.DISABLE_SSRF_CHECK;
// The import module also holds the import window; stub the page so it loads
globalThis.document ??= { getElementById: () => null };
globalThis.window ??= { location: { hostname: 'storymaps.io' } };
globalThis.location ??= { hostname: 'storymaps.io' };

const { fakeHttps } = await import('./fake-https.js');
const registerExport = (await import('../../server/routes/export-azure-devops.js')).default;
const registerImport = (await import('../../server/routes/import-azure-devops.js')).default;
const { toHtml } = await import('../../server/export-issues.js');
const { htmlToText, statusFromState, groupWorkItems, parseAzureCsv, azureItemUrl, azureStateNames } = await import('/src/transfer/azure-imports.js');
const { azureCsv, azureOrganization, azureProject, textToHtml } = await import('/src/transfer/export-issues.js');
const { parseCsv } = await import('/src/transfer/csv.js');

// The routes call dev.azure.com and stream progress back as server-sent events. The calls are
// answered with canned responses here.
const handlers = {};
const ctx = {
  route: (method, path, handler) => { handlers[`${method} ${path}`] = handler; },
  isProxyRateLimited: (req) => req.limited === true,
};
registerExport(ctx);
registerImport(ctx);

let requests;
let respond;
beforeEach(() => {
  requests = [];
  fakeHttps(async (req) => {
    const request = { ...req, json: req.body ? JSON.parse(req.body) : undefined, path: decodeURIComponent(new URL(req.url).pathname) };
    requests.push(request);
    return respond(request);
  });
});
afterEach(() => mock.restoreAll());

const call = async (path, body, { limited = false } = {}) => {
  const out = { status: null, chunks: [] };
  const res = {
    destroyed: false,
    writeHead: (status) => { out.status = status; },
    write: (chunk) => { out.chunks.push(chunk); },
    end: (chunk) => { if (chunk) out.chunks.push(chunk); },
  };
  await handlers[`POST ${path}`]({ headers: {}, limited }, res, {}, body);
  const text = out.chunks.join('');
  if (!text.startsWith('event:')) return { status: out.status, json: JSON.parse(text) };
  const events = text.split('\n\n').filter(Boolean).map(block => {
    const [eventLine, dataLine] = block.split('\n');
    return { event: eventLine.slice('event: '.length), data: JSON.parse(dataLine.slice('data: '.length)) };
  });
  const progress = events.filter(e => e.event === 'progress').map(e => e.data);
  return { status: out.status, progress, done: events.find(e => e.event === 'done')?.data, error: events.find(e => e.event === 'error')?.data };
};

const creds = { organization: 'acme', project: 'Web Shop', token: 'pat-secret' };
const SIGN_IN = [203, '<html>Sign in to your account</html>', { 'content-type': 'text/html' }];

describe('Azure DevOps export', () => {
  const issues = [
    { title: 'Card', description: 'Visa & <Mastercard>\n\nSlice: MVP\nStory map: https://storymaps.io/abc#card-1', status: 'done', labels: ['mvp', 'pay'], points: 3 },
    { title: 'Cash', status: 'in-progress', labels: ['mvp'] },
    { title: 'Voucher', status: 'blocked', labels: [] },
  ];
  // A Scrum project: its backlog work is a Product Backlog Item, estimated with Effort
  const scrum = (req, extra = () => null) => {
    if (req.path.endsWith('/workitemtypecategories/Microsoft.RequirementCategory')) return [200, { defaultWorkItemType: { name: 'Product Backlog Item' } }];
    if (req.method === 'GET' && req.path.endsWith('/workitemtypes/Product Backlog Item')) {
      return [200, {
        states: [{ name: 'New', category: 'Proposed' }, { name: 'Approved', category: 'Proposed' }, { name: 'Committed', category: 'InProgress' }, { name: 'Done', category: 'Completed' }],
        fields: [{ referenceName: 'System.Title' }, { referenceName: 'Microsoft.VSTS.Scheduling.Effort' }],
      }];
    }
    return extra(req);
  };
  const creates = () => requests.filter(r => r.method === 'POST' && r.path.includes('/_apis/wit/workitems/$'));
  const moves = () => requests.filter(r => r.method === 'PATCH');
  const fieldsOf = (req) => Object.fromEntries(req.json.map(op => [op.path.replace('/fields/', ''), op.value]));

  test('one work item per card, of the type the project uses, with tags, estimate and a link back', async () => {
    let id = 100;
    respond = (req) => scrum(req, () => [200, req.method === 'POST' ? { id: ++id } : {}]);
    const { progress, done } = await call('/api/export/azure-devops', { ...creds, issues });
    assert.deepEqual(done, { created: 3, failed: 0 });

    assert.equal(creates().length, 3);
    const first = creates()[0];
    assert.equal(first.url, 'https://dev.azure.com/acme/Web%20Shop/_apis/wit/workitems/$Product%20Backlog%20Item?api-version=7.1');
    assert.equal(first.headers['Content-Type'], 'application/json-patch+json');
    assert.equal(first.headers.Authorization, `Basic ${Buffer.from(':pat-secret').toString('base64')}`);
    assert.deepEqual(fieldsOf(first), {
      'System.Title': 'Card',
      'System.Description': '<div>Visa &amp; &lt;Mastercard&gt;</div><div><br></div><div>Slice: MVP<br>Story map: <a href="https://storymaps.io/abc#card-1">https://storymaps.io/abc#card-1</a></div>',
      'System.Tags': 'mvp; pay',
      'Microsoft.VSTS.Scheduling.Effort': 3,
    });
    assert.deepEqual(fieldsOf(creates()[2]), { 'System.Title': 'Voucher' });

    // Done and in-progress cards are moved on; a blocked card stays where new work starts
    assert.deepEqual(moves().map(r => [r.path, fieldsOf(r)['System.State']]), [
      ['/acme/_apis/wit/workitems/101', 'Done'], ['/acme/_apis/wit/workitems/102', 'Committed'],
    ]);
    const created = progress.filter(p => p.status === 'created');
    assert.deepEqual(created.map(p => [p.key, p.url, p.note]), [
      ['101', 'https://dev.azure.com/acme/Web%20Shop/_workitems/edit/101', undefined],
      ['102', 'https://dev.azure.com/acme/Web%20Shop/_workitems/edit/102', undefined],
      ['103', 'https://dev.azure.com/acme/Web%20Shop/_workitems/edit/103', undefined],
    ]);
  });

  test('a work item that cannot be moved is still created, with a note', async () => {
    respond = (req) => scrum(req, () => (req.method === 'PATCH' ? [400, { message: 'TF401320: Rule Error for field State' }] : [200, { id: 7 }]));
    const { progress, done } = await call('/api/export/azure-devops', { ...creds, issues: [issues[0]] });
    assert.deepEqual(done, { created: 1, failed: 0 });
    assert.equal(progress.find(p => p.status === 'created').note, 'status not set');
  });

  test('when tags cannot be made, the work items go across without them from then on', async () => {
    let id = 0;
    respond = (req) => scrum(req, () => {
      if (req.method !== 'POST') return [200, {}];
      return fieldsOf(req)['System.Tags'] ? [400, { message: 'TF401289: The current user does not have permissions to create tags.' }] : [200, { id: ++id }];
    });
    const { progress, done } = await call('/api/export/azure-devops', { ...creds, issues: issues.slice(0, 2) });
    assert.deepEqual(done, { created: 2, failed: 0 });
    assert.equal(creates().length, 3, 'the first is tried twice, the second goes without tags straight away');
    assert.deepEqual(progress.filter(p => p.status === 'created').map(p => p.note), ['no tags', 'no tags']);
  });

  test('a work item Azure DevOps rejects is counted as failed and the rest carry on', async () => {
    let id = 0;
    respond = (req) => scrum(req, () => (req.method === 'POST' && fieldsOf(req)['System.Title'] === 'Cash' ? [400, { message: 'Title is not valid' }] : [200, { id: ++id }]));
    const { progress, done } = await call('/api/export/azure-devops', { ...creds, issues });
    assert.deepEqual(done, { created: 2, failed: 1 });
    assert.equal(progress.find(p => p.status === 'error').error, 'Title is not valid');
  });

  test('a token that does not sign in stops the export before anything is made', async () => {
    respond = () => SIGN_IN;
    const { done } = await call('/api/export/azure-devops', { ...creds, issues });
    assert.equal(done.created, 0);
    assert.match(done.error, /^Authentication failed/);
    assert.equal(creates().length, 0);
  });

  test('verify checks the work items of the project and names who the token belongs to', async () => {
    respond = (req) => (req.path.endsWith('/connectionData') ? [200, { authenticatedUser: { providerDisplayName: 'Jack' } }] : [200, { value: [] }]);
    assert.deepEqual((await call('/api/export/azure-devops/verify', creds)).json, { ok: true, displayName: 'Jack' });
    assert.equal(requests[0].url, 'https://dev.azure.com/acme/Web%20Shop/_apis/wit/workitemtypes?api-version=7.1');

    respond = (req) => (req.path.endsWith('/connectionData') ? [401, ''] : [200, { value: [] }]);
    assert.deepEqual((await call('/api/export/azure-devops/verify', creds)).json, { ok: true, displayName: 'acme/Web Shop' });
  });

  test('verify reports a bad token and a project that is not there', async () => {
    respond = () => [401, ''];
    const bad = await call('/api/export/azure-devops/verify', creds);
    assert.equal(bad.status, 401);
    assert.match(bad.json.error, /^Authentication failed/);

    respond = () => [404, { message: 'TF200016: The following project does not exist: Web Shop.' }];
    const missing = await call('/api/export/azure-devops/verify', creds);
    assert.equal(missing.status, 404);
    assert.match(missing.json.error, /does not exist/);
  });

  test('rejects bad input before calling Azure DevOps', async () => {
    respond = () => assert.fail('Azure DevOps should not be called');
    assert.equal((await call('/api/export/azure-devops', { ...creds, organization: 'evil.example.com/x', issues })).status, 400);
    assert.equal((await call('/api/export/azure-devops', { ...creds, project: '_apis', issues })).status, 400);
    assert.equal((await call('/api/export/azure-devops', { ...creds, project: 'a/b', issues })).status, 400);
    assert.equal((await call('/api/export/azure-devops', creds)).status, 400);
    assert.equal((await call('/api/export/azure-devops/verify', { organization: 'acme' })).status, 400);
    assert.equal((await call('/api/export/azure-devops', { ...creds, issues }, { limited: true })).status, 429);
  });
});

describe('Azure DevOps import', () => {
  const types = { value: [
    { name: 'Epic', states: [{ name: 'New', category: 'Proposed' }, { name: 'Active', category: 'InProgress' }] },
    { name: 'User Story', states: [{ name: 'New', category: 'Proposed' }, { name: 'Active', category: 'InProgress' }, { name: 'Resolved', category: 'Resolved' }, { name: 'Closed', category: 'Completed' }, { name: 'Removed', category: 'Removed' }] },
  ] };
  const item = (id, type, state, extra = {}) => ({ id, fields: { 'System.Id': id, 'System.Title': `Item ${id}`, 'System.WorkItemType': type, 'System.State': state, ...extra } });
  const answer = (items, onBatch = () => null) => (req) => {
    if (req.path.endsWith('/_apis/wit/workitemtypes')) return [200, types];
    if (req.path.endsWith('/_apis/wit/wiql')) return [200, { workItems: items.map(i => ({ id: i.id })) }];
    if (req.path.endsWith('/_apis/wit/workitemsbatch')) return onBatch(req) || [200, { value: req.json.ids.map(id => items.find(i => i.id === id)) }];
    return assert.fail(`unexpected call to ${req.url}`);
  };

  test('lists every work item of the project with its status, tags, estimate and parent', async () => {
    respond = answer([
      item(1, 'Epic', 'Active', { 'System.Description': '<div>Paying</div>' }),
      item(2, 'User Story', 'Closed', { 'System.Parent': 1, 'System.Tags': 'backend; Checkout Team', 'Microsoft.VSTS.Scheduling.StoryPoints': 5 }),
      item(3, 'User Story', 'Resolved'),
      item(4, 'User Story', 'Removed'),
      item(5, 'Bug', 'Triaged'),
    ]);
    const { done } = await call('/api/import/azure-devops', creds);
    assert.equal(done.organization, 'acme');
    assert.equal(done.project, 'Web Shop');
    assert.equal(done.itemCount, 5);
    assert.deepEqual(done.items[0], { id: 1, title: 'Item 1', type: 'Epic', state: 'Active', status: 'in-progress', description: '<div>Paying</div>', tags: [] });
    assert.deepEqual(done.items[1], { id: 2, title: 'Item 2', type: 'User Story', state: 'Closed', status: 'done', tags: ['backend', 'Checkout Team'], points: 5, parentId: 1 });
    assert.deepEqual(done.items.map(i => i.status), ['in-progress', 'done', 'in-progress', 'removed', undefined], 'a state the project did not describe is left to its name');

    const wiql = requests.find(r => r.path.endsWith('/wiql'));
    assert.equal(wiql.url, 'https://dev.azure.com/acme/Web%20Shop/_apis/wit/wiql?$top=10000&api-version=7.1');
    assert.match(wiql.json.query, /\[System\.TeamProject\] = @project/);
  });

  test('fetches the work items 200 at a time', async () => {
    const items = Array.from({ length: 450 }, (_, i) => item(i + 1, 'User Story', 'New'));
    respond = answer(items);
    const { done, progress } = await call('/api/import/azure-devops', creds);
    assert.equal(done.itemCount, 450);
    assert.deepEqual(requests.filter(r => r.path.endsWith('/workitemsbatch')).map(r => r.json.ids.length), [200, 200, 50]);
    assert.deepEqual(progress.filter(p => p.phase === 'items').map(p => p.fetched), [0, 200, 400, 450]);
  });

  test('a project with no such estimate field is asked again without the estimates', async () => {
    respond = answer([item(1, 'User Story', 'New')], (req) =>
      (req.json.fields.some(f => f.startsWith('Microsoft.VSTS.Scheduling')) ? [400, { message: 'TF51535: Cannot find field Microsoft.VSTS.Scheduling.Size.' }] : null));
    const { done } = await call('/api/import/azure-devops', creds);
    assert.equal(done.itemCount, 1);
  });

  test('a token that does not sign in is reported', async () => {
    respond = () => SIGN_IN;
    const { error } = await call('/api/import/azure-devops', creds);
    assert.match(error.error, /^Authentication failed/);
  });

  test('rejects missing fields and a bad organization before calling Azure DevOps', async () => {
    respond = () => assert.fail('Azure DevOps should not be called');
    assert.equal((await call('/api/import/azure-devops', { organization: 'acme', project: 'Shop' })).status, 400);
    assert.equal((await call('/api/import/azure-devops', { ...creds, organization: 'acme/../x' })).status, 400);
    assert.equal((await call('/api/import/azure-devops', { ...creds, token: 'x'.repeat(300) })).status, 400);
  });
});

describe('Azure DevOps work items', () => {
  test('a description loses its markup and keeps its lines', () => {
    assert.equal(htmlToText('<div>As a shopper&nbsp;I want</div><div><br></div><ul><li>Visa</li><li>Master&amp;card</li></ul><p>See <a href="https://x.test">the &quot;spec&quot;</a></p>'),
      'As a shopper I want\n\n- Visa\n- Master&card\nSee the "spec"');
    assert.equal(htmlToText('Plain text'), 'Plain text');
    assert.equal(htmlToText(undefined), '');
  });

  test('a state is read by its name in every process', () => {
    assert.deepEqual(['New', 'To Do', 'Proposed', 'Approved', 'Active', 'Doing', 'Committed', 'Resolved', 'Closed', 'Done', 'Removed', ''].map(statusFromState),
      ['planned', 'planned', 'planned', 'planned', 'in-progress', 'in-progress', 'in-progress', 'in-progress', 'done', 'done', 'removed', 'planned']);
  });

  test('work items sit under the epic above them, however many levels up', () => {
    const epics = groupWorkItems([
      { id: 1, title: 'Checkout', type: 'Epic', status: 'in-progress', description: '<div>Paying</div>' },
      { id: 2, title: 'Cards', type: 'Feature', status: 'planned', parentId: 1 },
      { id: 3, title: 'Visa', type: 'User Story', state: 'Closed', parentId: 2, tags: ['backend'], points: 3, description: '<p>Take Visa</p>' },
      { id: 4, title: 'Call the bank', type: 'Task', status: 'planned', parentId: 3 },
      { id: 5, title: 'Write the runbook', type: 'Task', status: 'planned', parentId: 2 },
      { id: 6, title: 'Old idea', type: 'User Story', status: 'removed', parentId: 1 },
      { id: 7, title: 'Loose bug', type: 'Bug', state: 'Active' },
    ]);
    assert.equal(epics.length, 2);
    assert.deepEqual({ ...epics[0], stories: epics[0].stories.map(s => s.summary) },
      { key: '1', summary: 'Checkout', status: 'in-progress', description: 'Paying', stories: ['Cards', 'Visa', 'Write the runbook'] });
    assert.deepEqual(epics[0].stories[1], { key: '3', summary: 'Visa', type: 'User Story', status: 'done', stateName: 'Closed', description: 'Take Visa', points: 3, labels: ['backend'] });
    assert.deepEqual(epics[1], { key: null, summary: 'No epic', stories: [{ key: '7', summary: 'Loose bug', type: 'Bug', status: 'in-progress', stateName: 'Active', description: undefined, points: undefined, labels: [] }] });
  });

  test('the review step names each status the way the project does', () => {
    const story = (status, stateName) => ({ status, stateName });
    // The Basic process
    assert.deepEqual(azureStateNames([{ stories: [story('planned', 'To Do'), story('in-progress', 'Doing'), story('planned', 'To Do')] }]),
      { planned: 'To Do', 'in-progress': 'Doing' });
    // The Agile process, where one status covers two states, and an epic with a state of its own
    assert.deepEqual(azureStateNames([{ status: 'planned', stateName: 'New', stories: [story('in-progress', 'Active'), story('in-progress', 'Resolved'), story('done', 'Closed')] }]),
      { planned: 'New', 'in-progress': 'Active, Resolved', done: 'Closed' });
    // Rows with no state name leave the usual words in place
    assert.deepEqual(azureStateNames([{ stories: [story('planned', undefined)] }]), {});
  });

  test('the link to a work item needs the organization and the project', () => {
    assert.equal(azureItemUrl('acme', 'Web Shop', '12'), 'https://dev.azure.com/acme/Web%20Shop/_workitems/edit/12');
    assert.equal(azureItemUrl('', 'Web Shop', '12'), '');
  });
});

describe('Azure DevOps CSV', () => {
  const csv = (...rows) => rows.map(r => r.join(',')).join('\n');

  test('a flat list is read by its columns', () => {
    const { items, projectName } = parseAzureCsv('﻿' + csv(
      ['ID', 'Work Item Type', 'Title', 'Assigned To', 'State', 'Tags', 'Story Points', 'Parent', 'Area Path', 'Description'],
      ['1', 'Epic', 'Checkout', '', 'Active', '', '', '', 'Web Shop\\Team A', ''],
      ['2', 'User Story', 'Card payment', 'Jack', 'Closed', '"backend; Checkout Team"', '5', '1', 'Web Shop', '<div>Visa</div>'],
    ));
    assert.equal(projectName, 'Web Shop');
    assert.deepEqual(items, [
      { id: '1', title: 'Checkout', type: 'Epic', state: 'Active', description: undefined, tags: [], points: undefined, parentId: undefined },
      { id: '2', title: 'Card payment', type: 'User Story', state: 'Closed', description: '<div>Visa</div>', tags: ['backend', 'Checkout Team'], points: 5, parentId: '1' },
    ]);
  });

  test('a tree of work items says who the parent is by its Title columns', () => {
    const { items } = parseAzureCsv(csv(
      ['ID', 'Work Item Type', 'Title 1', 'Title 2', 'Title 3', 'State'],
      ['1', 'Epic', 'Checkout', '', '', 'New'],
      ['2', 'Feature', '', 'Cards', '', 'New'],
      ['3', 'User Story', '', '', 'Visa', 'New'],
      ['4', 'Feature', '', 'Cash', '', 'New'],
      ['5', 'Epic', 'Account', '', '', 'New'],
      ['6', 'User Story', '', 'Sign in', '', 'New'],
    ));
    assert.deepEqual(items.map(i => [i.title, i.parentId]), [
      ['Checkout', undefined], ['Cards', '1'], ['Visa', '2'], ['Cash', '1'], ['Account', undefined], ['Sign in', '5'],
    ]);
    assert.deepEqual(groupWorkItems(items).map(e => [e.summary, e.stories.map(s => s.summary)]), [
      ['Checkout', ['Cards', 'Visa', 'Cash']], ['Account', ['Sign in']],
    ]);
  });

  test('a file without the columns it needs is refused', () => {
    assert.throws(() => parseAzureCsv(csv(['Title', 'State'], ['A', 'New'])), /Missing required columns: ID, Work Item Type, Title/);
  });

  test('the export has one row per card, of the chosen type, with HTML and tags in one column', () => {
    const rows = parseCsv(azureCsv([
      { title: 'Card', description: 'Visa\nMastercard\n\nStory map: https://storymaps.io/abc', labels: ['mvp', 'pay'] },
      { title: 'Cash', description: '', labels: [] },
    ], { workItemType: 'Product Backlog Item' }));
    assert.deepEqual(rows, [
      ['Work Item Type', 'Title', 'Description', 'Tags'],
      ['Product Backlog Item', 'Card', '<div>Visa<br>Mastercard</div><div><br></div><div>Story map: <a href="https://storymaps.io/abc">https://storymaps.io/abc</a></div>', 'mvp; pay'],
      ['Product Backlog Item', 'Cash', '', ''],
    ]);
    assert.deepEqual(parseCsv(azureCsv([{ title: 'Cash', description: '', labels: [] }]))[0], ['Work Item Type', 'Title', 'Description'], 'no State column, and no Tags column without tags');
  });

  test('the app and the server write the same HTML', () => {
    const text = 'One & <two>\nthree\n\nhttps://storymaps.io/abc "quoted"';
    assert.equal(textToHtml(text), toHtml(text));
  });

  test('the organization is read from its name or from a link', () => {
    assert.deepEqual(['acme', ' https://dev.azure.com/acme ', 'dev.azure.com/acme/Web%20Shop/_boards', 'https://acme.visualstudio.com/Shop', 'https://acme@dev.azure.com/acme/Shop/_git/x', ''].map(azureOrganization),
      ['acme', 'acme', 'acme', 'acme', 'acme', '']);
  });

  test('the project is read from a link that names one', () => {
    assert.deepEqual(['acme', 'dev.azure.com/acme', 'https://dev.azure.com/acme/storymaps/', 'dev.azure.com/acme/Web%20Shop/_boards', 'https://acme.visualstudio.com/Shop', 'https://dev.azure.com/acme/_settings', ''].map(azureProject),
      ['', '', 'storymaps', 'Web Shop', 'Shop', '', '']);
  });
});
