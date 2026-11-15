import { describe, test, before, after, beforeEach, afterEach, mock } from 'node:test';
import { strict as assert } from 'node:assert';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dns from 'node:dns';

delete process.env.DISABLE_SSRF_CHECK;
const { fakeHttps } = await import('./fake-https.js');
const routes = {};
for (const name of ['export-jira', 'export-linear', 'export-asana', 'export-phabricator', 'import-phabricator']) {
  routes[name] = (await import(`../../server/routes/${name}.js`)).default;
}

// The export routes make one issue per card in each tracker and stream progress back as
// server-sent events. No epics, parent tasks or sections are made.
// Jira, Linear and Asana go through https.request, which is answered with canned responses here.
const handlers = {};
const ctx = {
  route: (method, path, handler) => { handlers[`${method} ${path}`] = handler; },
  isProxyRateLimited: (req) => req.limited === true,
};
Object.values(routes).forEach(register => register(ctx));

let requests;
let respond;
beforeEach(() => {
  requests = [];
  fakeHttps(async (req) => {
    const request = { ...req, json: req.body ? JSON.parse(req.body) : undefined };
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
const finished = (progress) => progress.filter(p => p.type === 'issue' && p.status !== 'creating').map(p => `${p.title}: ${p.status}`);

describe('Jira export', () => {
  const creds = { instanceUrl: 'acme.atlassian.net', email: 'me@example.com', token: 'secret' };
  const issues = [
    { title: 'Card', description: 'Visa and Mastercard\n\nSlice: MVP\nStep: Pay\nStory map: https://storymaps.io/abc#card-1', status: 'planned', labels: ['mvp', 'pay', 'backend'] },
    { title: 'Cash', description: 'Notes and coins', status: 'none', labels: ['mvp', 'pay'] },
  ];
  let nextKey;
  beforeEach(() => { nextKey = 1; });
  const isCreate = (req) => req.method === 'POST' && req.url.endsWith('/rest/api/3/issue');
  const creates = () => requests.filter(isCreate).map(r => r.json.fields);

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

  test('creates one Story per card with its labels, and no epics or parents', async () => {
    respond = () => [201, { key: `SHOP-${nextKey++}` }];
    const { progress, done } = await call('/api/export/jira', { ...creds, projectKey: 'SHOP', issues });
    assert.deepEqual(done, { created: 2, failed: 0 });
    assert.deepEqual(finished(progress), ['Card: created', 'Cash: created']);
    assert.deepEqual(progress.filter(p => p.status === 'created').map(p => p.key), ['SHOP-1', 'SHOP-2']);
    assert.equal(requests.length, 2, 'cards that are not started need no transition');
    const [card, cash] = creates();
    assert.deepEqual([card.project, card.issuetype, card.summary, card.labels], [{ key: 'SHOP' }, { name: 'Story' }, 'Card', ['mvp', 'pay', 'backend']]);
    assert.equal('parent' in card, false);
    assert.deepEqual(cash.labels, ['mvp', 'pay']);
  });

  test('the description keeps its paragraphs and line breaks, and links the story map', async () => {
    respond = () => [201, { key: 'SHOP-1' }];
    await call('/api/export/jira', { ...creds, projectKey: 'SHOP', issues: [issues[0]] });
    const { description } = creates()[0];
    assert.deepEqual(description.content[0], { type: 'paragraph', content: [{ type: 'text', text: 'Visa and Mastercard' }] });
    assert.deepEqual(description.content[1].content, [
      { type: 'text', text: 'Slice: MVP' }, { type: 'hardBreak' },
      { type: 'text', text: 'Step: Pay' }, { type: 'hardBreak' },
      { type: 'text', text: 'Story map: ' },
      { type: 'text', text: 'https://storymaps.io/abc#card-1', marks: [{ type: 'link', attrs: { href: 'https://storymaps.io/abc#card-1' } }] },
    ]);
  });

  test('a card with no description sends none', async () => {
    respond = () => [201, { key: 'SHOP-1' }];
    await call('/api/export/jira', { ...creds, projectKey: 'SHOP', issues: [{ title: 'Bare' }] });
    assert.deepEqual(creates()[0], { project: { key: 'SHOP' }, summary: 'Bare', issuetype: { name: 'Story' } });
  });

  test('cards in progress or done are moved with a transition, looked up once', async () => {
    const transitions = { transitions: [
      { id: '11', to: { name: 'In Review', statusCategory: { key: 'indeterminate' } } },
      { id: '21', to: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } },
      { id: '31', to: { name: 'Done', statusCategory: { key: 'done' } } },
    ] };
    respond = (req) => (isCreate(req) ? [201, { key: `SHOP-${nextKey++}` }] : req.method === 'GET' ? [200, transitions] : [204]);
    const cards = [{ title: 'A', status: 'done' }, { title: 'B', status: 'in-progress' }, { title: 'C', status: 'done' }, { title: 'D', status: 'blocked' }];
    const { progress, done } = await call('/api/export/jira', { ...creds, projectKey: 'SHOP', issues: cards });
    assert.deepEqual(done, { created: 4, failed: 0 });
    const moves = requests.filter(r => r.method === 'POST' && r.url.endsWith('/transitions'));
    assert.deepEqual(moves.map(r => [r.url.split('/').at(-2), r.json.transition.id]), [['SHOP-1', '31'], ['SHOP-2', '21'], ['SHOP-3', '31']]);
    assert.equal(requests.filter(r => r.method === 'GET').length, 2, 'one lookup for done, one for in progress');
    assert.equal(progress.some(p => p.note), false);
  });

  test('an issue that cannot be moved is still created, with a note', async () => {
    respond = (req) => (isCreate(req) ? [201, { key: 'SHOP-1' }] : [200, { transitions: [] }]);
    const { progress, done } = await call('/api/export/jira', { ...creds, projectKey: 'SHOP', issues: [{ title: 'A', status: 'done' }] });
    assert.deepEqual(done, { created: 1, failed: 0 });
    assert.equal(progress.find(p => p.status === 'created').note, 'status not set');
  });

  test('a project without the Story type gets Tasks, from then on', async () => {
    respond = (req) => (req.json.fields.issuetype.name === 'Story' ? [400, { errors: { issuetype: 'Specify a valid issue type' } }] : [201, { key: `SHOP-${nextKey++}` }]);
    const { done } = await call('/api/export/jira', { ...creds, projectKey: 'SHOP', issues });
    assert.deepEqual(done, { created: 2, failed: 0 });
    assert.deepEqual(creates().map(f => f.issuetype.name), ['Story', 'Task', 'Task']);
  });

  test('a project that refuses labels gets its issues without them, with a note', async () => {
    respond = (req) => (req.json.fields.labels ? [400, { errors: { labels: "Field 'labels' cannot be set." } }] : [201, { key: `SHOP-${nextKey++}` }]);
    const { progress, done } = await call('/api/export/jira', { ...creds, projectKey: 'SHOP', issues });
    assert.deepEqual(done, { created: 2, failed: 0 });
    assert.equal(creates().length, 3, 'only the first issue is tried with labels');
    assert.deepEqual(progress.filter(p => p.status === 'created').map(p => p.note), ['no labels', 'no labels']);
  });

  test('an issue Jira rejects is counted as failed and the rest carry on', async () => {
    respond = (req) => (req.json.fields.summary === 'Card' ? [400, { errors: { summary: 'Too long' } }] : [201, { key: `SHOP-${nextKey++}` }]);
    const { progress, done } = await call('/api/export/jira', { ...creds, projectKey: 'SHOP', issues });
    assert.deepEqual(done, { created: 1, failed: 1 });
    assert.deepEqual(finished(progress), ['Card: error', 'Cash: created']);
    assert.match(progress.find(p => p.status === 'error').error, /Too long/);
  });

  test('rejects bad input before calling Jira', async () => {
    respond = () => assert.fail('Jira should not be called');
    const tooMany = Array.from({ length: 2001 }, () => ({ title: 'x' }));
    assert.equal((await call('/api/export/jira', { ...creds, projectKey: 'SHOP', issues: tooMany })).status, 400);
    assert.equal((await call('/api/export/jira', { ...creds, projectKey: 'SHOP', issues: [{ title: '  ' }] })).status, 400);
    assert.equal((await call('/api/export/jira', { ...creds, projectKey: 'SH OP', issues })).status, 400);
    assert.equal((await call('/api/export/jira', { ...creds, instanceUrl: 'https://192.168.1.10', projectKey: 'SHOP', issues })).status, 400);
    assert.equal((await call('/api/export/jira', { ...creds, projectKey: 'SHOP' })).status, 400);
    assert.equal((await call('/api/export/jira', { ...creds, projectKey: 'SHOP', issues }, { limited: true })).status, 429);
  });
});

describe('Linear export', () => {
  const teams = { data: { teams: { nodes: [{ id: 'team-1', name: 'Engineering', key: 'ENG' }] } } };
  const states = { data: { team: { states: { nodes: [
    { id: 'st-done', type: 'completed', position: 5 }, { id: 'st-review', type: 'started', position: 4 },
    { id: 'st-doing', type: 'started', position: 3 }, { id: 'st-todo', type: 'unstarted', position: 2 }, { id: 'st-backlog', type: 'backlog', position: 1 },
  ] } } } };
  const labelPage = (nodes) => ({ data: { issueLabels: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } } });
  const issues = [
    { title: 'Card', description: 'Paying', status: 'done', labels: ['mvp', 'pay'], points: 3 },
    { title: 'Cash', status: 'blocked', labels: ['mvp'], points: 'lots' },
  ];
  let n, existingLabels;
  beforeEach(() => { n = 0; existingLabels = []; });
  const answer = (req) => {
    const { query, variables } = req.json;
    if (query.includes('teams')) return [200, teams];
    if (query.includes('states')) return [200, states];
    if (query.includes('issueLabels(')) return [200, labelPage(existingLabels)];
    if (query.includes('issueLabelCreate')) return [200, { data: { issueLabelCreate: { success: true, issueLabel: { id: `label-${variables.input.name}` } } } }];
    return [200, { data: { issueCreate: { success: true, issue: { id: `issue-${++n}`, identifier: `ENG-${n}`, url: `https://linear.app/x/ENG-${n}` } } } }];
  };
  const inputs = (mutation) => requests.filter(r => r.json.query.includes(mutation)).map(r => r.json.variables.input);

  test('verify returns the Linear user name', async () => {
    respond = () => [200, { data: { viewer: { name: 'Jack' } } }];
    assert.deepEqual((await call('/api/export/linear/verify', { apiKey: 'lin_api_x' })).json, { ok: true, name: 'Jack' });
  });

  test('creates one issue per card in the team, with its labels, status and estimate', async () => {
    respond = answer;
    const { progress, done } = await call('/api/export/linear', { apiKey: 'lin_api_x', teamKey: 'eng', issues });
    assert.deepEqual(done, { created: 2, failed: 0 });
    assert.deepEqual(finished(progress), ['Card: created', 'Cash: created']);
    assert.equal(progress.find(p => p.status === 'created').url, 'https://linear.app/x/ENG-1');
    const [card, cash] = inputs('issueCreate(');
    assert.deepEqual(card, { teamId: 'team-1', title: 'Card', description: 'Paying', estimate: 3, stateId: 'st-done', labelIds: ['label-mvp', 'label-pay'] });
    assert.deepEqual(cash, { teamId: 'team-1', title: 'Cash', labelIds: ['label-mvp'] }, 'no parent, and a blocked card starts where Linear puts new issues');
  });

  test('planned cards go to the first unstarted status and cards in progress to the first started one', async () => {
    respond = answer;
    await call('/api/export/linear', { apiKey: 'lin_api_x', teamKey: 'ENG', issues: [{ title: 'A', status: 'planned' }, { title: 'B', status: 'in-progress' }, { title: 'C', status: 'none' }] });
    assert.deepEqual(inputs('issueCreate(').map(i => i.stateId), ['st-todo', 'st-doing', undefined]);
  });

  test('uses labels the team can already see and makes only the missing ones, in the team', async () => {
    existingLabels = [
      { id: 'ws-mvp', name: 'MVP', isGroup: false, team: null },
      { id: 'other-pay', name: 'pay', isGroup: false, team: { id: 'team-2' } },
      { id: 'group-pay', name: 'pay', isGroup: true, team: null },
    ];
    respond = answer;
    await call('/api/export/linear', { apiKey: 'lin_api_x', teamKey: 'ENG', issues });
    assert.deepEqual(inputs('issueLabelCreate'), [{ name: 'pay', teamId: 'team-1' }]);
    assert.deepEqual(inputs('issueCreate(')[0].labelIds, ['ws-mvp', 'label-pay']);
  });

  test('a label that cannot be made is left off and the issue is still created', async () => {
    respond = (req) => (req.json.query.includes('issueLabelCreate') ? [200, { errors: [{ message: 'Not allowed' }] }] : answer(req));
    const { progress, done } = await call('/api/export/linear', { apiKey: 'lin_api_x', teamKey: 'ENG', issues: [issues[0]] });
    assert.deepEqual(done, { created: 1, failed: 0 });
    assert.equal('labelIds' in inputs('issueCreate(')[0], false);
    assert.equal(progress.find(p => p.status === 'created').note, '2 labels left off');
  });

  test('an unknown team ends with an error', async () => {
    respond = () => [200, teams];
    const { done } = await call('/api/export/linear', { apiKey: 'lin_api_x', teamKey: 'OPS', issues });
    assert.deepEqual(done, { created: 0, failed: 0, error: 'Team "OPS" not found' });
  });

  test('an issue Linear rejects is counted as failed and the rest carry on', async () => {
    respond = (req) => (req.json.query.includes('issueCreate(') && req.json.variables.input.title === 'Card' ? [200, { errors: [{ message: 'Title too long' }] }] : answer(req));
    const { progress, done } = await call('/api/export/linear', { apiKey: 'lin_api_x', teamKey: 'ENG', issues });
    assert.deepEqual(done, { created: 1, failed: 1 });
    assert.equal(progress.find(p => p.status === 'error').error, 'Title too long');
  });

  test('rejects bad input before calling Linear', async () => {
    respond = () => assert.fail('Linear should not be called');
    assert.equal((await call('/api/export/linear', { apiKey: 'lin_api_x', teamKey: 'EN G', issues })).status, 400);
    assert.equal((await call('/api/export/linear', { apiKey: 'lin_api_x', teamKey: 'ENG' })).status, 400);
    assert.equal((await call('/api/export/linear/verify', {})).status, 400);
  });
});

describe('Asana export', () => {
  const issues = [
    { title: 'Card', description: 'Paying', status: 'done', labels: ['mvp', 'pay'] },
    { title: 'Cash', status: 'planned', labels: ['mvp'] },
  ];
  let n, existingTags;
  beforeEach(() => { n = 0; existingTags = []; });
  const answer = (req) => {
    if (req.url.includes('/projects/1200')) return [200, { data: { gid: '1200', workspace: { gid: '77' } } }];
    if (req.url.includes('/typeahead')) return [200, { data: existingTags }];
    if (req.url.endsWith('/workspaces/77/tags')) return [201, { data: { gid: `tag-${req.json.data.name}` } }];
    return [201, { data: { gid: String(++n) } }];
  };
  const tasks = () => requests.filter(r => r.url.endsWith('/tasks'));

  test('verify returns the Asana user name', async () => {
    respond = () => [200, { data: { name: 'Jack' } }];
    assert.deepEqual((await call('/api/export/asana/verify', { token: 't' })).json, { ok: true, name: 'Jack' });
  });

  test('creates one task per card in the project, tagged, with no sections or subtasks', async () => {
    respond = answer;
    const { progress, done } = await call('/api/export/asana', { token: 't', projectGid: '1200', issues });
    assert.deepEqual(done, { created: 2, failed: 0 });
    assert.deepEqual(finished(progress), ['Card: created', 'Cash: created']);
    assert.deepEqual(progress.filter(p => p.status === 'created').map(p => p.gid), ['1', '2']);
    const [card, cash] = tasks();
    assert.equal(card.url, 'https://app.asana.com/api/1.0/tasks');
    assert.deepEqual(card.json.data, { name: 'Card', notes: 'Paying', projects: ['1200'], completed: true, tags: ['tag-mvp', 'tag-pay'] });
    assert.deepEqual(cash.json.data, { name: 'Cash', notes: '', projects: ['1200'], completed: false, tags: ['tag-mvp'] });
    assert.equal(card.headers.Authorization, 'Bearer t');
    assert.equal(requests.some(r => r.url.includes('/sections') || r.url.includes('/subtasks')), false);
  });

  test('uses a tag that already has the name and makes only the missing ones', async () => {
    existingTags = [{ gid: '500', name: 'MVP' }, { gid: '501', name: 'mvp-old' }];
    respond = answer;
    await call('/api/export/asana', { token: 't', projectGid: '1200', issues });
    assert.deepEqual(requests.filter(r => r.url.endsWith('/tags')).map(r => r.json.data), [{ name: 'pay' }]);
    assert.deepEqual(tasks()[0].json.data.tags, ['500', 'tag-pay']);
    assert.match(requests.find(r => r.url.includes('/typeahead')).url, /workspaces\/77\/typeahead\?resource_type=tag&count=20&opt_fields=name&query=mvp$/);
  });

  test('a tag that cannot be made is left off and the task is still created', async () => {
    respond = (req) => (req.url.endsWith('/tags') ? [403, { errors: [{ message: 'Forbidden' }] }] : answer(req));
    const { progress, done } = await call('/api/export/asana', { token: 't', projectGid: '1200', issues: [issues[1]] });
    assert.deepEqual(done, { created: 1, failed: 0 });
    assert.equal('tags' in tasks()[0].json.data, false);
    assert.equal(progress.find(p => p.status === 'created').note, '1 tag left off');
  });

  test('cards with no labels need no tag lookups', async () => {
    respond = answer;
    await call('/api/export/asana', { token: 't', projectGid: '1200', issues: [{ title: 'Bare' }] });
    assert.deepEqual(requests.map(r => r.url), ['https://app.asana.com/api/1.0/tasks']);
  });

  test('a project that cannot be read ends with an error', async () => {
    respond = () => [404, { errors: [{ message: 'project: Not a recognized ID' }] }];
    const { done } = await call('/api/export/asana', { token: 't', projectGid: '1200', issues });
    assert.deepEqual(done, { created: 0, failed: 0, error: 'project: Not a recognized ID' });
  });

  test('a task Asana rejects is counted as failed and the rest carry on', async () => {
    respond = (req) => (req.url.endsWith('/tasks') && req.json.data.name === 'Card' ? [400, { errors: [{ message: 'Bad name' }] }] : answer(req));
    const { progress, done } = await call('/api/export/asana', { token: 't', projectGid: '1200', issues });
    assert.deepEqual(done, { created: 1, failed: 1 });
    assert.equal(progress.find(p => p.status === 'error').error, 'Bad name');
  });

  test('rejects a project ID that is not a number before calling Asana', async () => {
    respond = () => assert.fail('Asana should not be called');
    assert.equal((await call('/api/export/asana', { token: 't', projectGid: '../users', issues })).status, 400);
  });
});

// Phabricator is called through the curl program rather than https.request. Put a fake curl first on
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
let data = args.includes('-d') ? args[args.indexOf('-d') + 1] : '';
if (data === '@-') data = fs.readFileSync(0, 'utf8');
fs.appendFileSync(dir + '/calls.jsonl', JSON.stringify({ url, data, args }) + '\\n');
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
    const { url, data, args } = JSON.parse(line);
    return { method: new URL(url).pathname.split('/').pop(), host: new URL(url).host, fields: Object.fromEntries(new URLSearchParams(data)), args };
  });
  const task = (id) => ({ result: { object: { id, phid: `PHID-TASK-${id}` } } });

  describe('export', () => {
    const creds = { instanceUrl: 'phabricator.example.org', token: 'api-secret' };

    test('verify returns the Phabricator user name', async () => {
      conduit({ 'user.whoami': [{ result: { userName: 'jack' } }] });
      assert.deepEqual((await call('/api/export/phabricator/verify', creds)).json, { ok: true, userName: 'jack' });
      assert.equal(calls()[0].fields['api.token'], 'api-secret');
      assert.ok(!calls()[0].args.join(' ').includes('api-secret'), 'the token is never on the command line');
    });

    test('curl connects to the address that was checked, over https only', async () => {
      conduit({ 'user.whoami': [{ result: { userName: 'jack' } }] });
      await call('/api/export/phabricator/verify', creds);
      const { args } = calls()[0];
      assert.equal(args[args.indexOf('--resolve') + 1], 'phabricator.example.org:443:93.184.215.14');
      assert.equal(args[args.indexOf('--proto') + 1], '=https');
    });

    test('a host name that resolves to a private address is refused before curl runs', async () => {
      conduit({ 'user.whoami': [{ result: { userName: 'jack' } }] });
      mock.method(dns, 'lookup', (host, options, callback) => callback(null, [{ address: '10.0.0.5', family: 4 }]));
      const { json } = await call('/api/export/phabricator/verify', creds);
      assert.equal(json.ok, false);
      assert.match(json.error, /private address/);
      assert.equal(existsSync(join(dir, 'calls.jsonl')), false);
    });

    test('creates one task per card with its status and the typed tags, and no epic tag or subtasks', async () => {
      conduit({ 'maniphest.edit': [task(10), task(11)] });
      const issues = [
        { title: 'Checkout', description: 'Paying\n\nSlice: MVP\nStep: Pay', status: 'in-progress', labels: ['mvp', 'pay'] },
        { title: 'Card', status: 'done' },
      ];
      const { progress, done } = await call('/api/export/phabricator', { ...creds, tags: ['shop'], issues });
      assert.deepEqual(done, { created: 2, failed: 0 });
      assert.deepEqual(progress.filter(p => p.status === 'created').map(p => p.id), ['T10', 'T11']);
      const [first, second] = calls();
      assert.equal(first.host, 'phabricator.example.org');
      assert.deepEqual(first.fields, {
        'api.token': 'api-secret',
        'transactions[0][type]': 'title', 'transactions[0][value]': 'Checkout',
        'transactions[1][type]': 'description', 'transactions[1][value]': 'Paying\n\nSlice: MVP\nStep: Pay',
        'transactions[2][type]': 'status', 'transactions[2][value]': 'progress',
        'transactions[3][type]': 'projects.add', 'transactions[3][value][0]': 'shop',
      });
      assert.equal(second.fields['transactions[2][value]'], 'resolved');
      assert.equal(Object.values(second.fields).includes('parent'), false);
    });

    test('with no tags typed, none are added', async () => {
      conduit({ 'maniphest.edit': [task(10)] });
      await call('/api/export/phabricator', { ...creds, issues: [{ title: 'Checkout', labels: ['mvp'] }] });
      assert.equal(Object.values(calls()[0].fields).includes('projects.add'), false);
    });

    test('a Conduit error is reported and the rest carry on', async () => {
      conduit({ 'maniphest.edit': [{ error_code: 'ERR-CONDUIT-CORE', error_info: 'Invalid project' }, task(11)] });
      const { progress, done } = await call('/api/export/phabricator', { ...creds, issues: [{ title: 'Checkout' }, { title: 'Card' }] });
      assert.deepEqual(done, { created: 1, failed: 1 });
      assert.equal(progress.find(p => p.status === 'error').error, 'Invalid project');
    });

    test('rejects a private instance before calling it', async () => {
      conduit({});
      assert.equal((await call('/api/export/phabricator', { ...creds, instanceUrl: 'https://localhost', issues: [] })).status, 400);
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
