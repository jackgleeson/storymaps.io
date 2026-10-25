import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

delete process.env.DISABLE_SSRF_CHECK;
const routes = {};
for (const name of ['export-jira', 'export-linear', 'export-asana', 'export-phabricator', 'import-phabricator']) {
  routes[name] = (await import(`../../server/routes/${name}.js`)).default;
}

// The export routes call each tracker's API and stream progress back as server-sent events.
// Jira, Linear and Asana go through fetch(), which is replaced with canned responses here.
const handlers = {};
const ctx = {
  route: (method, path, handler) => { handlers[`${method} ${path}`] = handler; },
  isProxyRateLimited: (req) => req.limited === true,
};
Object.values(routes).forEach(register => register(ctx));

const realFetch = globalThis.fetch;
let requests;
let respond;
beforeEach(() => {
  requests = [];
  globalThis.fetch = async (url, opts = {}) => {
    const request = { url: String(url), ...opts, json: opts.body ? JSON.parse(opts.body) : undefined };
    requests.push(request);
    const [status, body] = await respond(request);
    return { status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

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
const finished = (progress) => progress.filter(p => p.status !== 'creating').map(p => `${p.type} ${p.summary ?? p.name ?? p.title}: ${p.status}`);

describe('Jira export', () => {
  const creds = { instanceUrl: 'acme.atlassian.net', email: 'me@example.com', token: 'secret' };
  const epics = [{ summary: 'Checkout', description: 'Paying', stories: [{ summary: 'Card' }, { summary: 'Cash', description: 'Notes and coins' }] }];
  let nextKey;
  beforeEach(() => { nextKey = 1; });

  test('verify returns the Jira user name', async () => {
    respond = () => [200, { displayName: 'Jack' }];
    const res = await call('/api/export/jira/verify', creds);
    assert.deepEqual(res.json, { ok: true, displayName: 'Jack' });
    assert.equal(requests[0].url, 'https://acme.atlassian.net/rest/api/3/myself');
  });

  test('verify reports bad credentials and connection failures', async () => {
    respond = () => [401, { errorMessages: ['Client must be authenticated'] }];
    assert.deepEqual((await call('/api/export/jira/verify', creds)).json, { ok: false, error: 'Client must be authenticated' });
    respond = () => { throw new Error('getaddrinfo ENOTFOUND'); };
    const failed = await call('/api/export/jira/verify', creds);
    assert.equal(failed.status, 502);
    assert.match(failed.json.error, /^Connection failed: getaddrinfo ENOTFOUND/);
  });

  test('creates each epic, then its stories under it', async () => {
    respond = () => [201, { key: `SHOP-${nextKey++}` }];
    const { progress, done } = await call('/api/export/jira', { ...creds, projectKey: 'SHOP', epics });
    assert.deepEqual(done, { created: 3, failed: 0 });
    assert.deepEqual(finished(progress), ['epic Checkout: created', 'story Card: created', 'story Cash: created']);
    const [epic, card, cash] = requests.map(r => r.json.fields);
    assert.equal(requests[0].url, 'https://acme.atlassian.net/rest/api/3/issue');
    assert.deepEqual([epic.project, epic.issuetype, epic.summary], [{ key: 'SHOP' }, { name: 'Epic' }, 'Checkout']);
    assert.equal(epic.description.content[0].content[0].text, 'Paying');
    assert.deepEqual([card.issuetype, card.parent], [{ name: 'Story' }, { key: 'SHOP-1' }]);
    assert.equal(card.description.content[0].content[0].text, 'Imported from Storymaps.io', 'a default description when there is none');
    assert.equal(cash.description.content[0].content[0].text, 'Notes and coins');
  });

  test('a story Jira rejects is counted as failed and the rest carry on', async () => {
    respond = (req) => (req.json.fields.summary === 'Card' ? [400, { errors: { summary: 'Too long' } }] : [201, { key: `SHOP-${nextKey++}` }]);
    const { progress, done } = await call('/api/export/jira', { ...creds, projectKey: 'SHOP', epics });
    assert.deepEqual(done, { created: 2, failed: 1 });
    assert.deepEqual(finished(progress), ['epic Checkout: created', 'story Card: error', 'story Cash: created']);
  });

  test('when an epic fails, its stories are counted as failed too', async () => {
    respond = () => [400, { errorMessages: ['Issue type Epic does not exist'] }];
    const { done } = await call('/api/export/jira', { ...creds, projectKey: 'SHOP', epics });
    assert.deepEqual(done, { created: 0, failed: 3 });
  });

  test('rejects bad input before calling Jira', async () => {
    respond = () => assert.fail('Jira should not be called');
    const tooMany = Array.from({ length: 201 }, () => ({ summary: 'x' }));
    assert.equal((await call('/api/export/jira', { ...creds, projectKey: 'SHOP', epics: tooMany })).status, 400);
    assert.equal((await call('/api/export/jira', { ...creds, projectKey: 'SH OP', epics })).status, 400);
    assert.equal((await call('/api/export/jira', { ...creds, instanceUrl: 'https://192.168.1.10', projectKey: 'SHOP', epics })).status, 400);
    assert.equal((await call('/api/export/jira', { ...creds, projectKey: 'SHOP' })).status, 400);
    assert.equal((await call('/api/export/jira', { ...creds, projectKey: 'SHOP', epics }, { limited: true })).status, 429);
  });
});

describe('Linear export', () => {
  const teams = { data: { teams: { nodes: [{ id: 'team-1', name: 'Engineering', key: 'ENG' }] } } };
  const items = [{ name: 'Checkout', description: 'Paying', subissues: [{ name: 'Card', estimate: 0 }, { name: 'Cash', estimate: 'lots' }] }];
  let n;
  beforeEach(() => { n = 0; });
  const created = () => [200, { data: { issueCreate: { success: true, issue: { id: `issue-${++n}`, identifier: `ENG-${n}`, url: `https://linear.app/x/ENG-${n}` } } } }];

  test('verify returns the Linear user name', async () => {
    respond = () => [200, { data: { viewer: { name: 'Jack' } } }];
    assert.deepEqual((await call('/api/export/linear/verify', { apiKey: 'lin_api_x' })).json, { ok: true, name: 'Jack' });
  });

  test('creates each parent issue in the team, then its sub-issues under it', async () => {
    respond = (req) => (req.json.query.includes('teams') ? [200, teams] : created());
    const { progress, done } = await call('/api/export/linear', { apiKey: 'lin_api_x', teamKey: 'eng', items });
    assert.deepEqual(done, { created: 3, failed: 0 });
    assert.deepEqual(finished(progress), ['task Checkout: created', 'subtask Card: created', 'subtask Cash: created']);
    const [, parent, card, cash] = requests.map(r => r.json.variables?.input);
    assert.deepEqual(parent, { teamId: 'team-1', title: 'Checkout', description: 'Paying' });
    assert.deepEqual(card, { teamId: 'team-1', title: 'Card', parentId: 'issue-1', estimate: 0 });
    assert.equal('estimate' in cash, false, 'an estimate that is not a number is left out');
  });

  test('an unknown team ends with an error', async () => {
    respond = () => [200, teams];
    const { done } = await call('/api/export/linear', { apiKey: 'lin_api_x', teamKey: 'OPS', items });
    assert.deepEqual(done, { created: 0, failed: 0, error: 'Team "OPS" not found' });
  });

  test('when a parent issue fails, its sub-issues are counted as failed too', async () => {
    respond = (req) => (req.json.query.includes('teams') ? [200, teams] : [200, { errors: [{ message: 'Title too long' }] }]);
    const { done } = await call('/api/export/linear', { apiKey: 'lin_api_x', teamKey: 'ENG', items });
    assert.deepEqual(done, { created: 0, failed: 3 });
  });

  test('rejects bad input before calling Linear', async () => {
    respond = () => assert.fail('Linear should not be called');
    assert.equal((await call('/api/export/linear', { apiKey: 'lin_api_x', teamKey: 'EN G', items })).status, 400);
    assert.equal((await call('/api/export/linear', { apiKey: 'lin_api_x', teamKey: 'ENG' })).status, 400);
    assert.equal((await call('/api/export/linear/verify', {})).status, 400);
  });
});

describe('Asana export', () => {
  const items = [{ name: 'Checkout', notes: 'Paying', completed: true, subtasks: [{ name: 'Card' }, { name: 'Cash', completed: true }] }];
  let n;
  beforeEach(() => { n = 0; });

  test('verify returns the Asana user name', async () => {
    respond = () => [200, { data: { name: 'Jack' } }];
    assert.deepEqual((await call('/api/export/asana/verify', { token: 't' })).json, { ok: true, name: 'Jack' });
  });

  test('creates a section per item when asked, then the task in it and its subtasks', async () => {
    respond = () => [201, { data: { gid: String(++n) } }];
    const { progress, done } = await call('/api/export/asana', { token: 't', projectGid: '1200', createSections: true, items });
    assert.deepEqual(done, { created: 3, failed: 0 });
    assert.deepEqual(finished(progress), ['section Checkout: created', 'task Checkout: created', 'subtask Card: created', 'subtask Cash: created']);
    const [section, task, card, cash] = requests;
    assert.equal(section.url, 'https://app.asana.com/api/1.0/projects/1200/sections');
    assert.deepEqual(task.json.data, { name: 'Checkout', notes: 'Paying', projects: ['1200'], completed: true, memberships: [{ project: '1200', section: '1' }] });
    assert.equal(card.url, 'https://app.asana.com/api/1.0/tasks/2/subtasks');
    assert.deepEqual(card.json.data, { name: 'Card', notes: 'Imported from Storymaps.io', completed: false });
    assert.equal(cash.json.data.completed, true);
    assert.equal(task.headers.Authorization, 'Bearer t');
  });

  test('a section that fails does not stop the task', async () => {
    respond = (req) => (req.url.endsWith('/sections') ? [403, { errors: [{ message: 'Forbidden' }] }] : [201, { data: { gid: String(++n) } }]);
    const { done } = await call('/api/export/asana', { token: 't', projectGid: '1200', createSections: true, items });
    assert.deepEqual(done, { created: 3, failed: 0 });
    assert.equal('memberships' in requests[1].json.data, false);
  });

  test('when a task fails, its subtasks are counted as failed too', async () => {
    respond = () => [400, { errors: [{ message: 'Bad project' }] }];
    const { done } = await call('/api/export/asana', { token: 't', projectGid: '1200', items });
    assert.deepEqual(done, { created: 0, failed: 3 });
  });

  test('rejects a project ID that is not a number before calling Asana', async () => {
    respond = () => assert.fail('Asana should not be called');
    assert.equal((await call('/api/export/asana', { token: 't', projectGid: '../users', items })).status, 400);
  });
});

// Phabricator is called through the curl program rather than fetch(). Put a fake curl first on
// the PATH that records each call and answers from a list of canned Conduit responses.
describe('Phabricator', () => {
  let dir, realPath;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'fake-curl-'));
    writeFileSync(join(dir, 'curl'), `#!${process.execPath}
const fs = require('fs');
const dir = process.env.FAKE_CURL_DIR;
const args = process.argv.slice(2);
const url = args[args.length - 1];
const data = args.includes('-d') ? args[args.indexOf('-d') + 1] : '';
fs.appendFileSync(dir + '/calls.jsonl', JSON.stringify({ url, data }) + '\\n');
const method = new URL(url).pathname.split('/').pop();
const queue = JSON.parse(fs.readFileSync(dir + '/responses.json', 'utf8'))[method] || [];
const countsFile = dir + '/counts.json';
const counts = fs.existsSync(countsFile) ? JSON.parse(fs.readFileSync(countsFile, 'utf8')) : {};
const n = counts[method] || 0;
counts[method] = n + 1;
fs.writeFileSync(countsFile, JSON.stringify(counts));
const reply = queue[Math.min(n, queue.length - 1)] || { error_code: 'ERR-NOT-FAKED', error_info: method };
process.stdout.write(JSON.stringify(reply) + '\\n200');
`);
    chmodSync(join(dir, 'curl'), 0o755);
    realPath = process.env.PATH;
    process.env.PATH = `${dir}:${realPath}`;
    process.env.FAKE_CURL_DIR = dir;
  });
  after(() => {
    process.env.PATH = realPath;
    delete process.env.FAKE_CURL_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  const conduit = (responses) => {
    writeFileSync(join(dir, 'responses.json'), JSON.stringify(responses));
    for (const f of ['calls.jsonl', 'counts.json']) if (existsSync(join(dir, f))) rmSync(join(dir, f));
  };
  // Each call's method and form fields
  const calls = () => readFileSync(join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').map(line => {
    const { url, data } = JSON.parse(line);
    return { method: new URL(url).pathname.split('/').pop(), host: new URL(url).host, fields: Object.fromEntries(new URLSearchParams(data)) };
  });
  const task = (id) => ({ result: { object: { id, phid: `PHID-TASK-${id}` } } });

  describe('export', () => {
    const creds = { instanceUrl: 'phabricator.example.org', token: 'api-secret' };

    test('verify returns the Phabricator user name', async () => {
      conduit({ 'user.whoami': [{ result: { userName: 'jack' } }] });
      assert.deepEqual((await call('/api/export/phabricator/verify', creds)).json, { ok: true, userName: 'jack' });
      assert.equal(calls()[0].fields['api.token'], 'api-secret');
    });

    test('creates each task with its status and tags, then its subtasks linked to it', async () => {
      conduit({ 'maniphest.edit': [task(10), task(11)] });
      const items = [{ title: 'Checkout', description: 'Paying', status: 'in-progress', type: 'epic', subtasks: [{ title: 'Card', status: 'done' }] }];
      const { progress, done } = await call('/api/export/phabricator', { ...creds, tags: ['shop'], items });
      assert.deepEqual(done, { created: 2, failed: 0 });
      assert.deepEqual(progress.filter(p => p.status === 'created').map(p => p.id), ['T10', 'T11']);
      const [parent, sub] = calls();
      assert.equal(parent.host, 'phabricator.example.org');
      assert.deepEqual(parent.fields, {
        'api.token': 'api-secret',
        'transactions[0][type]': 'title', 'transactions[0][value]': 'Checkout',
        'transactions[1][type]': 'description', 'transactions[1][value]': 'Paying',
        'transactions[2][type]': 'status', 'transactions[2][value]': 'progress',
        'transactions[3][type]': 'projects.add', 'transactions[3][value][0]': 'epic', 'transactions[3][value][1]': 'shop',
      });
      assert.equal(sub.fields['transactions[2][value]'], 'resolved');
      assert.equal(sub.fields['transactions[3][type]'], 'parent');
      assert.equal(sub.fields['transactions[3][value]'], 'PHID-TASK-10');
      assert.equal(sub.fields['transactions[4][value][0]'], 'shop');
    });

    test('a Conduit error is reported, and the task and its subtasks are counted as failed', async () => {
      conduit({ 'maniphest.edit': [{ error_code: 'ERR-CONDUIT-CORE', error_info: 'Invalid project' }] });
      const { progress, done } = await call('/api/export/phabricator', { ...creds, items: [{ title: 'Checkout', subtasks: [{ title: 'Card' }] }] });
      assert.deepEqual(done, { created: 0, failed: 2 });
      assert.equal(progress.find(p => p.status === 'error').error, 'Invalid project');
    });

    test('rejects a private instance before calling it', async () => {
      conduit({});
      assert.equal((await call('/api/export/phabricator', { ...creds, instanceUrl: 'https://localhost', items: [] })).status, 400);
      assert.equal(existsSync(join(dir, 'calls.jsonl')), false);
    });
  });

  describe('import', () => {
    const creds = { instanceUrl: 'phabricator.example.org', token: 'api-secret', tags: ['shop'] };
    const phabTask = (id, name, status = 'open', extra = {}) => ({ id, phid: `PHID-TASK-${id}`, fields: { name, status: { value: status }, description: { raw: '' }, ...extra } });

    test('groups subtasks under their parent tasks', async () => {
      conduit({
        'project.search': [{ result: { data: [{ phid: 'PHID-PROJ-1', fields: { slug: 'shop' } }] } }],
        'maniphest.search': [{ result: { data: [phabTask(1, 'Checkout', 'progress'), phabTask(2, 'Card', 'resolved', { points: 3 }), phabTask(3, 'Loose')], cursor: { after: null } } }],
        'edge.search': [{ result: { data: [{ sourcePHID: 'PHID-TASK-2', destinationPHID: 'PHID-TASK-1' }] } }],
      });
      const { done } = await call('/api/import/phabricator', creds);
      assert.equal(done.taskCount, 3);
      assert.deepEqual(done.epics.map(e => [e.key, e.summary, e.status, e.stories.map(s => `${s.key} ${s.status} ${s.points}`)]), [
        ['T1', 'Checkout', 'in-progress', ['T2 done 3']],
        [null, 'Other', undefined, ['T3 planned undefined']],
      ]);
    });

    test('a task that is both a parent and a child appears once', async () => {
      conduit({
        'project.search': [{ result: { data: [{ phid: 'PHID-PROJ-1', fields: { slug: 'shop' } }] } }],
        'maniphest.search': [{ result: { data: [phabTask(1, 'Goal'), phabTask(2, 'Feature'), phabTask(3, 'Detail')], cursor: { after: null } } }],
        'edge.search': [{ result: { data: [
          { sourcePHID: 'PHID-TASK-2', destinationPHID: 'PHID-TASK-1' },
          { sourcePHID: 'PHID-TASK-3', destinationPHID: 'PHID-TASK-2' },
        ] } }],
      });
      const { done } = await call('/api/import/phabricator', creds);
      const keys = done.epics.flatMap(e => [e.key, ...e.stories.map(s => s.key)]).filter(Boolean);
      assert.deepEqual([...keys].sort(), ['T1', 'T2', 'T3']);
      assert.deepEqual(done.epics.map(e => [e.key, e.stories.map(s => s.key)]), [['T1', ['T2', 'T3']]], 'deeper tasks go under the top-level task');
    });

    test('a loop of parent links does not hang the import', async () => {
      conduit({
        'project.search': [{ result: { data: [{ phid: 'PHID-PROJ-1', fields: { slug: 'shop' } }] } }],
        'maniphest.search': [{ result: { data: [phabTask(1, 'One'), phabTask(2, 'Two')], cursor: { after: null } } }],
        'edge.search': [{ result: { data: [
          { sourcePHID: 'PHID-TASK-1', destinationPHID: 'PHID-TASK-2' },
          { sourcePHID: 'PHID-TASK-2', destinationPHID: 'PHID-TASK-1' },
        ] } }],
      });
      const { done } = await call('/api/import/phabricator', creds);
      const keys = done.epics.flatMap(e => [e.key, ...e.stories.map(s => s.key)]).filter(Boolean);
      assert.deepEqual([...keys].sort(), ['T1', 'T2']);
    });

    test('a tag that does not exist is an error', async () => {
      conduit({ 'project.search': [{ result: { data: [] } }] });
      const { error } = await call('/api/import/phabricator', creds);
      assert.match(error.error, /^No project tags found/);
    });

    test('needs at least one tag', async () => {
      conduit({});
      assert.equal((await call('/api/import/phabricator', { ...creds, tags: [] })).status, 400);
    });
  });
});
