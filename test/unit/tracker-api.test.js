import { describe, test, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';

delete process.env.DISABLE_SSRF_CHECK;
const registerJira = (await import('../../server/routes/import-jira.js')).default;
const registerLinear = (await import('../../server/routes/import-linear.js')).default;
const registerAsana = (await import('../../server/routes/import-asana.js')).default;

// The import routes call the tracker's API with fetch() and stream progress back as server-sent
// events. Replace fetch with canned tracker responses and collect the events.
const handlers = {};
const ctx = {
  route: (method, path, handler) => { handlers[`${method} ${path}`] = handler; },
  isProxyRateLimited: (req) => req.limited === true,
};
registerJira(ctx);
registerLinear(ctx);
registerAsana(ctx);

const realFetch = globalThis.fetch;
let requests;
let respond;
beforeEach(() => {
  requests = [];
  globalThis.fetch = async (url, opts = {}) => {
    requests.push({ url: String(url), ...opts });
    const [status, body] = await respond(String(url), opts);
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
  if (out.status !== 200) return { status: out.status, json: JSON.parse(text) };
  const events = text.split('\n\n').filter(Boolean).map(block => {
    const [eventLine, dataLine] = block.split('\n');
    return { event: eventLine.slice('event: '.length), data: JSON.parse(dataLine.slice('data: '.length)) };
  });
  return { status: 200, events, done: events.find(e => e.event === 'done')?.data, error: events.find(e => e.event === 'error')?.data };
};

describe('Jira import', () => {
  const body = { instanceUrl: 'acme.atlassian.net', email: 'me@example.com', token: 'secret', projectKey: 'SHOP' };
  const adf = (...paragraphs) => ({ type: 'doc', content: paragraphs.map(text => ({ type: 'paragraph', content: [{ type: 'text', text }] })) });
  const issue = (key, fields) => ({ key, fields: { summary: key, ...fields } });

  test('fetches epics and stories and groups the stories under their epics', async () => {
    respond = (url) => {
      const jql = new URL(url).searchParams.get('jql');
      if (jql.includes('issuetype = Epic')) return [200, { issues: [issue('SHOP-1', { summary: 'Checkout', description: adf('Paying', 'for things'), status: { statusCategory: { key: 'indeterminate' } } })] }];
      return [200, { issues: [
        issue('SHOP-2', { summary: 'Card', parent: { key: 'SHOP-1' }, status: { statusCategory: { key: 'done' } }, customfield_10016: 3, labels: ['pay'] }),
        issue('SHOP-3', { summary: 'Loose', status: { statusCategory: { key: 'new' } } }),
      ] }];
    };
    const { done } = await call('/api/import/jira', body);
    assert.equal(done.epicCount, 2);
    assert.equal(done.storyCount, 2);
    const [checkout, other] = done.epics;
    assert.equal(checkout.description, 'Paying\nfor things');
    assert.equal(checkout.status, 'in-progress');
    assert.deepEqual(checkout.stories.map(s => [s.key, s.status, s.points, s.labels]), [['SHOP-2', 'done', 3, ['pay']]]);
    assert.deepEqual([other.key, other.summary, other.stories.map(s => s.key)], [null, 'Other', ['SHOP-3']]);
  });

  test('calls the Jira API for the project with basic auth', async () => {
    respond = () => [200, { issues: [] }];
    await call('/api/import/jira', body);
    assert.ok(requests.every(r => r.url.startsWith('https://acme.atlassian.net/rest/api/3/search/jql?')));
    assert.match(new URL(requests[0].url).searchParams.get('jql'), /^project = "SHOP" AND issuetype = Epic/);
    assert.equal(requests[0].headers.Authorization, `Basic ${Buffer.from('me@example.com:secret').toString('base64')}`);
  });

  test('follows the next page token', async () => {
    respond = (url) => {
      const params = new URL(url).searchParams;
      if (params.get('jql').includes('Epic')) return [200, { issues: [] }];
      return params.get('nextPageToken')
        ? [200, { issues: [issue('S-2', {})] }]
        : [200, { issues: [issue('S-1', {})], nextPageToken: 'page2' }];
    };
    const { done } = await call('/api/import/jira', body);
    assert.equal(done.storyCount, 2);
  });

  test('turns a Jira error into an error event', async () => {
    respond = () => [400, { errorMessages: ['The value SHOP does not exist'] }];
    const { error, done } = await call('/api/import/jira', body);
    assert.equal(error.error, 'The value SHOP does not exist');
    assert.equal(done, undefined);
  });

  test('a response that is not JSON is an error event with the status', async () => {
    respond = () => [502, '<html>Bad gateway</html>'];
    const { error } = await call('/api/import/jira', body);
    assert.match(error.error, /^HTTP 502/);
  });

  test('rejects missing fields, a bad project key and a private instance before calling Jira', async () => {
    respond = () => assert.fail('Jira should not be called');
    assert.equal((await call('/api/import/jira', { ...body, token: '' })).status, 400);
    assert.equal((await call('/api/import/jira', { ...body, projectKey: 'SHOP" OR 1=1' })).status, 400);
    assert.equal((await call('/api/import/jira', { ...body, instanceUrl: 'http://10.0.0.5' })).status, 400);
    assert.equal((await call('/api/import/jira', body, { limited: true })).status, 429);
  });
});

describe('Linear import', () => {
  const body = { apiKey: 'lin_api_x', teamKey: 'eng' };
  const team = { id: 'team-1', name: 'Engineering', key: 'ENG' };
  const node = (identifier, extra = {}) => ({ id: `id-${identifier}`, identifier, title: identifier, url: `https://linear.app/x/${identifier}`, state: { type: 'unstarted' }, labels: { nodes: [] }, children: { nodes: [] }, ...extra });

  test('finds the team, ignoring case, and returns its issues and projects', async () => {
    respond = (url, opts) => {
      const { query } = JSON.parse(opts.body);
      if (query.includes('teams')) return [200, { data: { teams: { nodes: [team] } } }];
      return [200, { data: { issues: { nodes: [
        node('ENG-1', { state: { type: 'started' }, estimate: 0, project: { id: 'p1', name: 'Shop', url: 'u' }, children: { nodes: [{ id: 'id-ENG-2' }] } }),
        node('ENG-2', { state: { type: 'completed' }, parent: { id: 'id-ENG-1', identifier: 'ENG-1' }, project: { id: 'p1', name: 'Shop', url: 'u' }, labels: { nodes: [{ name: 'web' }] } }),
        node('ENG-3', { state: { type: 'cancelled' } }),
      ], pageInfo: { hasNextPage: false } } } }];
    };
    const { done } = await call('/api/import/linear', body);
    assert.equal(done.teamName, 'Engineering');
    assert.deepEqual(done.issues.map(i => [i.identifier, i.status]), [['ENG-1', 'in-progress'], ['ENG-2', 'done'], ['ENG-3', 'done']]);
    assert.equal(done.issues[0].points, 0);
    assert.equal(done.issues[0].hasChildren, true);
    assert.equal(done.issues[1].parentIdentifier, 'ENG-1');
    assert.deepEqual(done.issues[1].labels, ['web']);
    assert.deepEqual(done.projects, [{ id: 'p1', name: 'Shop', url: 'u' }]);
    assert.equal(requests[0].headers.Authorization, 'lin_api_x');
  });

  test('says which teams exist when the key is not found', async () => {
    respond = () => [200, { data: { teams: { nodes: [team, { id: 't2', name: 'Design', key: 'DES' }] } } }];
    const { error } = await call('/api/import/linear', { ...body, teamKey: 'OPS' });
    assert.equal(error.error, 'No team found with key "OPS". Available: ENG, DES');
  });

  test('follows the page cursor', async () => {
    respond = (url, opts) => {
      const { query, variables } = JSON.parse(opts.body);
      if (query.includes('teams')) return [200, { data: { teams: { nodes: [team] } } }];
      return variables.after
        ? [200, { data: { issues: { nodes: [node('ENG-2')], pageInfo: { hasNextPage: false } } } }]
        : [200, { data: { issues: { nodes: [node('ENG-1')], pageInfo: { hasNextPage: true, endCursor: 'c1' } } } }];
    };
    const { done } = await call('/api/import/linear', body);
    assert.equal(done.issueCount, 2);
  });

  test('a bad API key is an authentication error', async () => {
    respond = () => [401, { errors: [{ message: 'Unauthorized' }] }];
    const { error } = await call('/api/import/linear', body);
    assert.equal(error.error, 'Authentication failed');
  });

  test('rejects missing fields and a bad team key before calling Linear', async () => {
    respond = () => assert.fail('Linear should not be called');
    assert.equal((await call('/api/import/linear', { teamKey: 'ENG' })).status, 400);
    assert.equal((await call('/api/import/linear', { ...body, teamKey: 'ENG ORG' })).status, 400);
    assert.equal((await call('/api/import/linear', { ...body, apiKey: 'x'.repeat(300) })).status, 400);
  });
});

describe('Asana import', () => {
  const body = { token: 'asana-token', projectGid: '1200' };

  test('returns the project, its tasks with their subtasks, and its sections', async () => {
    respond = (url) => {
      const { pathname, searchParams } = new URL(url);
      if (pathname.endsWith('/projects/1200')) return [200, { data: { name: 'Shop' } }];
      if (pathname.endsWith('/sections')) return [200, { data: [{ gid: 's1', name: 'Doing' }] }];
      if (pathname.endsWith('/tasks/11/subtasks')) return [200, { data: [{ gid: '111', name: 'Card', completed: true, notes: ' Visa ' }] }];
      if (pathname.endsWith('/tasks') && searchParams.get('project') === '1200') {
        return [200, { data: [
          { gid: '11', name: 'Checkout', completed: false, num_subtasks: 1, notes: '', memberships: [{ section: { gid: 's1', name: 'Doing' } }] },
          { gid: '12', name: 'Search', completed: true, num_subtasks: 0, notes: 'Find things' },
        ] }];
      }
      return [404, { errors: [{ message: 'not found' }] }];
    };
    const { done } = await call('/api/import/asana', body);
    assert.equal(done.projectName, 'Shop');
    assert.deepEqual(done.sections, [{ gid: 's1', name: 'Doing' }]);
    const [checkout, search] = done.epics;
    assert.equal(checkout.sectionName, 'Doing');
    assert.deepEqual(checkout.stories, [{ key: '111', summary: 'Card', description: 'Visa', status: 'done' }]);
    assert.equal(search.status, 'done');
    assert.equal(search.description, 'Find things');
    assert.ok(!requests.some(r => r.url.includes('/tasks/12/subtasks')), 'no subtask call for a task without subtasks');
    assert.equal(requests[0].headers.Authorization, 'Bearer asana-token');
  });

  test('an Asana error for the project is an error event', async () => {
    respond = () => [403, { errors: [{ message: 'Not authorized' }] }];
    const { error } = await call('/api/import/asana', body);
    assert.equal(error.error, 'Not authorized');
  });

  test('rejects a project ID that is not a number before calling Asana', async () => {
    respond = () => assert.fail('Asana should not be called');
    assert.equal((await call('/api/import/asana', { ...body, projectGid: '12/../users' })).status, 400);
  });
});
