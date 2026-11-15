import { sendSSE, fetchWithTimeout, safeJson } from '../http-helpers.js';
import { cleanIssues, invalidIssues, createEach, errorText, uniqueLabels } from '../export-issues.js';

export default function register(ctx) {
  const { route } = ctx;
  route('POST', '/api/export/linear/verify', async (req, res, params, body) => {
    if (ctx.isProxyRateLimited(req)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Rate limit exceeded. Try again in a minute.' }));
      return;
    }
    const { apiKey } = body;
    if (!apiKey || typeof apiKey !== 'string' || apiKey.length > 256) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Missing or invalid API key' }));
      return;
    }
    try {
      const r = await fetchWithTimeout('https://api.linear.app/graphql', {
        method: 'POST',
        headers: {
          'Authorization': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: '{ viewer { id name email } }' })
      }, 10_000);
      const data = await safeJson(r);
      if (r.status === 401 || r.status === 403 || data.errors?.length) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: data.errors?.[0]?.message || 'Authentication failed' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, name: data.data?.viewer?.name || data.data?.viewer?.email || 'Unknown' }));
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: `Connection failed: ${e.message}` }));
    }
  });

  route('POST', '/api/export/linear', async (req, res, params, body) => {
    if (ctx.isProxyRateLimited(req)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Rate limit exceeded. Try again in a minute.' }));
      return;
    }
    const { apiKey, teamKey } = body;
    if (!apiKey || typeof apiKey !== 'string' || apiKey.length > 256) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing or invalid API key' }));
      return;
    }
    if (!teamKey || typeof teamKey !== 'string' || teamKey.length > 50 || !/^[a-zA-Z0-9_-]+$/.test(teamKey)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing or invalid team key' }));
      return;
    }
    const issues = cleanIssues(body.issues);
    if (!issues) return invalidIssues(res);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    const linearGql = async (query, variables) => {
      const r = await fetchWithTimeout('https://api.linear.app/graphql', {
        method: 'POST',
        headers: { 'Authorization': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables })
      }, 30_000);
      const data = await safeJson(r);
      if (r.status === 401 || r.status === 403) throw new Error('Authentication failed');
      if (data.errors?.length) throw new Error(data.errors[0].message);
      return data.data;
    };
    const stop = (error) => {
      sendSSE(res, 'done', { created: 0, failed: 0, error: errorText(error) });
      res.end();
    };

    let teamId;
    try {
      const teamsData = await linearGql('{ teams { nodes { id name key } } }');
      const team = teamsData.teams.nodes.find(t => t.key.toLowerCase() === teamKey.toLowerCase());
      if (!team) return stop(`Team "${teamKey}" not found`);
      teamId = team.id;
    } catch (e) {
      return stop(e.message || 'Unknown error');
    }

    // The team's statuses: the first of each type, in the team's own order. Planned cards go
    // to the first unstarted status, cards in progress to the first started one, done cards
    // to the first completed one. The rest start where Linear puts new issues.
    const stateIds = {};
    try {
      const data = await linearGql('query($id: String!) { team(id: $id) { states { nodes { id type position } } } }', { id: teamId });
      const TYPE = { planned: 'unstarted', 'in-progress': 'started', done: 'completed' };
      const states = [...(data.team?.states?.nodes || [])].sort((a, b) => a.position - b.position);
      for (const [status, type] of Object.entries(TYPE)) {
        const state = states.find(s => s.type === type);
        if (state) stateIds[status] = state.id;
      }
    } catch { /* issues are still created, in the team's first status */ }

    // Labels: use the ones the team can already see, and make the rest in the team.
    // A label that can't be found or made is left off; the issue is still created.
    const labelIds = new Map();
    const wanted = uniqueLabels(issues);
    if (wanted.length) {
      sendSSE(res, 'progress', { type: 'labels', status: 'creating', count: wanted.length });
      try {
        const LABELS = 'query($after: String) { issueLabels(first: 250, after: $after) { nodes { id name isGroup team { id } } pageInfo { hasNextPage endCursor } } }';
        let after = null;
        for (let page = 0; page < 8; page++) {
          const data = await linearGql(LABELS, { after });
          for (const label of data.issueLabels.nodes) {
            if (label.isGroup || (label.team && label.team.id !== teamId)) continue;
            const name = label.name.toLowerCase();
            // A label of the team wins over a workspace label with the same name
            if (!labelIds.has(name) || label.team) labelIds.set(name, label.id);
          }
          if (!data.issueLabels.pageInfo.hasNextPage) break;
          after = data.issueLabels.pageInfo.endCursor;
        }
      } catch { /* carry on and try to make them */ }
      const CREATE_LABEL = 'mutation($input: IssueLabelCreateInput!) { issueLabelCreate(input: $input) { success issueLabel { id } } }';
      for (const name of wanted) {
        if (labelIds.has(name.toLowerCase())) continue;
        try {
          const result = await linearGql(CREATE_LABEL, { input: { name, teamId } });
          if (result.issueLabelCreate?.success) labelIds.set(name.toLowerCase(), result.issueLabelCreate.issueLabel.id);
        } catch { /* left off */ }
      }
    }

    const CREATE_ISSUE = 'mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url } } }';
    await createEach(res, issues, async (issue) => {
      const input = { teamId, title: issue.title };
      if (issue.description) input.description = issue.description;
      if (issue.points != null) input.estimate = Math.round(issue.points);
      if (stateIds[issue.status]) input.stateId = stateIds[issue.status];
      const ids = issue.labels.map(name => labelIds.get(name.toLowerCase())).filter(Boolean);
      if (ids.length) input.labelIds = ids;
      const result = await linearGql(CREATE_ISSUE, { input });
      if (!result.issueCreate.success) throw new Error('Issue creation failed');
      const missing = issue.labels.length - ids.length;
      return {
        key: result.issueCreate.issue.identifier, url: result.issueCreate.issue.url,
        ...(missing > 0 && { note: `${missing} label${missing === 1 ? '' : 's'} left off` }),
      };
    });
  });
}
