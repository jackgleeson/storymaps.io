import { sendSSE } from '../http-helpers.js';
import { cleanIssues, invalidIssues, createEach, errorText, toHtml } from '../export-issues.js';
import { API_VERSION, azureTarget, azureFetch } from '../azure-devops.js';

// The field that holds the estimate depends on the process: Agile, Scrum and Basic, or CMMI
const POINTS_FIELDS = ['Microsoft.VSTS.Scheduling.StoryPoints', 'Microsoft.VSTS.Scheduling.Effort', 'Microsoft.VSTS.Scheduling.Size'];

const rateLimited = (res) => {
  res.writeHead(429, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Rate limit exceeded. Try again in a minute.' }));
};

export default function register(ctx) {
  const { route } = ctx;
  route('POST', '/api/export/azure-devops/verify', async (req, res, params, body) => {
    if (ctx.isProxyRateLimited(req)) return rateLimited(res);
    const target = azureTarget(body);
    if (target.error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: target.error }));
      return;
    }
    try {
      // The token has to reach the work items of this project, so that is what is checked
      await azureFetch(`${target.base}/_apis/wit/workitemtypes?${API_VERSION}`, target.headers, {}, 10_000);
    } catch (e) {
      const auth = /^Authentication failed/.test(e.message);
      const answered = auth || /not found|does not exist/i.test(e.message);
      res.writeHead(auth ? 401 : answered ? 404 : 502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: answered ? e.message : `Connection failed: ${e.message}` }));
      return;
    }
    // The name of the person the token belongs to, when Azure DevOps will say
    let displayName = `${target.organization}/${target.project}`;
    try {
      const data = await azureFetch(`${target.orgBase}/_apis/connectionData?api-version=7.1-preview`, target.headers, {}, 10_000);
      const name = data.authenticatedUser?.providerDisplayName;
      if (name && !/^anonymous$/i.test(name)) displayName = name;
    } catch { /* the project name will do */ }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, displayName }));
  });

  route('POST', '/api/export/azure-devops', async (req, res, params, body) => {
    if (ctx.isProxyRateLimited(req)) return rateLimited(res);
    const target = azureTarget(body);
    if (target.error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: target.error }));
      return;
    }
    const issues = cleanIssues(body.issues);
    if (!issues) return invalidIssues(res);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    const { base, orgBase, headers } = target;

    // The work item type for backlog work depends on the process of the project: User Story,
    // Product Backlog Item, Issue or Requirement. The project says which one it uses.
    let type;
    try {
      const category = await azureFetch(`${base}/_apis/wit/workitemtypecategories/Microsoft.RequirementCategory?${API_VERSION}`, headers);
      type = category.defaultWorkItemType?.name;
      if (!type) throw new Error('This project has no work item type for backlog work');
    } catch (e) {
      sendSSE(res, 'done', { created: 0, failed: 0, error: errorText(e.message) });
      res.end();
      return;
    }

    // The states and fields of that type. Cards in progress go to its first state that is in
    // progress and done cards to its first completed one. The rest stay where new work starts.
    const stateNames = {};
    let pointsField = null;
    try {
      const info = await azureFetch(`${base}/_apis/wit/workitemtypes/${encodeURIComponent(type)}?${API_VERSION}`, headers);
      const first = (category) => (info.states || []).find(state => state.category === category)?.name;
      if (first('InProgress')) stateNames['in-progress'] = first('InProgress');
      if (first('Completed')) stateNames.done = first('Completed');
      const fields = new Set((info.fields || []).map(field => field.referenceName));
      pointsField = POINTS_FIELDS.find(name => fields.has(name)) || null;
    } catch { /* work items are still created, in their first state and with no estimate */ }

    const add = (field, value) => ({ op: 'add', path: `/fields/${field}`, value });
    const patch = { contentType: 'application/json-patch+json' };

    // Some people may not make new tags. When Azure DevOps says so, carry on without tags,
    // for this work item and the ones after it.
    let sendTags = true;
    const createItem = async (issue) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const ops = [add('System.Title', issue.title.slice(0, 255))];
        const description = toHtml(issue.description);
        if (description) ops.push(add('System.Description', description));
        const tagged = sendTags && issue.labels.length > 0;
        if (tagged) ops.push(add('System.Tags', issue.labels.join('; ')));
        if (pointsField && issue.points != null) ops.push(add(pointsField, issue.points));
        try {
          return await azureFetch(`${base}/_apis/wit/workitems/$${encodeURIComponent(type)}?${API_VERSION}`, headers, { method: 'POST', body: ops, ...patch });
        } catch (e) {
          if (tagged && /\btags?\b/i.test(e.message)) { sendTags = false; continue; }
          throw e;
        }
      }
      throw new Error('Azure DevOps would not create the work item');
    };

    // A new work item starts in the first state. Failing to move it on does not fail it.
    const moveItem = async (id, status) => {
      if (!stateNames[status]) return !['in-progress', 'done'].includes(status);
      try {
        await azureFetch(`${orgBase}/_apis/wit/workitems/${id}?${API_VERSION}`, headers, { method: 'PATCH', body: [add('System.State', stateNames[status])], ...patch });
        return true;
      } catch {
        return false;
      }
    };

    await createEach(res, issues, async (issue) => {
      const item = await createItem(issue);
      const moved = await moveItem(item.id, issue.status);
      const notes = [];
      if (!sendTags && issue.labels.length) notes.push('no tags');
      if (!moved) notes.push('status not set');
      return { key: String(item.id), url: target.itemUrl(item.id), ...(notes.length && { note: notes.join(', ') }) };
    });
  });
}
