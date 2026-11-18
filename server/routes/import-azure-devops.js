import { sendSSE } from '../http-helpers.js';
import { API_VERSION, azureTarget, azureFetch } from '../azure-devops.js';

const MAX_ITEMS = 10_000;
const BATCH = 200;
// The field that holds the estimate depends on the process: Agile, Scrum and Basic, or CMMI
const POINTS_FIELDS = ['Microsoft.VSTS.Scheduling.StoryPoints', 'Microsoft.VSTS.Scheduling.Effort', 'Microsoft.VSTS.Scheduling.Size'];
const FIELDS = ['System.Id', 'System.Title', 'System.WorkItemType', 'System.State', 'System.Description', 'System.Tags', 'System.Parent'];

// Every state belongs to one of five categories, whatever a team has named it
const STATUS = { Proposed: 'planned', InProgress: 'in-progress', Resolved: 'in-progress', Completed: 'done', Removed: 'removed' };

export default function register(ctx) {
  const { route } = ctx;
  route('POST', '/api/import/azure-devops', async (req, res, params, body) => {
    if (ctx.isProxyRateLimited(req)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Rate limit exceeded. Try again in a minute.' }));
      return;
    }
    const target = azureTarget(body);
    if (target.error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: target.error }));
      return;
    }
    const { base, orgBase, headers } = target;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    const fail = (phase, e) => {
      sendSSE(res, 'error', { phase, error: e.message });
      res.end();
    };

    // Phase 1: the work item types of the project, for the category of each of their states
    sendSSE(res, 'progress', { phase: 'types' });
    const categories = new Map();
    try {
      const types = await azureFetch(`${base}/_apis/wit/workitemtypes?${API_VERSION}`, headers);
      for (const type of types.value || []) {
        for (const state of type.states || []) categories.set(`${type.name}\n${state.name}`, state.category);
      }
    } catch (e) {
      return fail('types', e);
    }

    // Phase 2: the IDs of every work item in the project
    let ids;
    try {
      const data = await azureFetch(`${base}/_apis/wit/wiql?$top=${MAX_ITEMS}&${API_VERSION}`, headers, {
        method: 'POST',
        body: { query: 'SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project ORDER BY [System.Id]' },
      });
      ids = (data.workItems || []).map(item => item.id).slice(0, MAX_ITEMS);
    } catch (e) {
      return fail('items', e);
    }
    sendSSE(res, 'progress', { phase: 'items', fetched: 0, total: ids.length });

    // Phase 3: their fields, 200 at a time. A project whose process has no such estimate
    // field is asked again without the estimates.
    const found = [];
    let fields = [...FIELDS, ...POINTS_FIELDS];
    try {
      for (let i = 0; i < ids.length; i += BATCH) {
        if (res.destroyed) break;
        const batch = { ids: ids.slice(i, i + BATCH), errorPolicy: 'Omit' };
        let data;
        try {
          data = await azureFetch(`${orgBase}/_apis/wit/workitemsbatch?${API_VERSION}`, headers, { method: 'POST', body: { ...batch, fields } });
        } catch (e) {
          if (fields.length === FIELDS.length || !/Microsoft\.VSTS\.Scheduling|field/i.test(e.message)) throw e;
          fields = FIELDS;
          data = await azureFetch(`${orgBase}/_apis/wit/workitemsbatch?${API_VERSION}`, headers, { method: 'POST', body: { ...batch, fields } });
        }
        found.push(...(data.value || []).filter(item => item?.fields));
        sendSSE(res, 'progress', { phase: 'items', fetched: found.length, total: ids.length });
      }
    } catch (e) {
      return fail('items', e);
    }

    // Phase 4: one plain list. The app groups the work items under their epics.
    const items = found.map(({ id, fields: f }) => {
      const points = POINTS_FIELDS.map(name => f[name]).find(value => typeof value === 'number');
      const type = f['System.WorkItemType'] || '';
      const state = f['System.State'] || '';
      return {
        id,
        title: f['System.Title'] || '',
        type,
        state,
        status: STATUS[categories.get(`${type}\n${state}`)],
        description: f['System.Description'] || undefined,
        tags: String(f['System.Tags'] || '').split(';').map(tag => tag.trim()).filter(Boolean),
        points,
        parentId: f['System.Parent'] ?? undefined,
      };
    });

    sendSSE(res, 'done', { organization: target.organization, project: target.project, items, itemCount: items.length });
    res.end();
  });
}
