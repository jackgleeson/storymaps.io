import { sendSSE, fetchWithTimeout, safeJson } from '../http-helpers.js';

export default function register(ctx) {
  const { route } = ctx;
  route('POST', '/api/import/linear', async (req, res, params, body) => {
    if (ctx.isProxyRateLimited(req)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Rate limit exceeded. Try again in a minute.' }));
      return;
    }
    const { apiKey, teamKey } = body;
    if (!apiKey || typeof apiKey !== 'string' || !teamKey || typeof teamKey !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing required fields: apiKey, teamKey' }));
      return;
    }
    if (apiKey.length > 256) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'API key too long.' }));
      return;
    }
    if (!/^[A-Za-z0-9_-]{1,50}$/.test(teamKey)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid team key. Must be 1-50 alphanumeric characters.' }));
      return;
    }

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

    const linearStatusToStorymaps = (type) => {
      // Linear spells it canceled; cancelled is kept in case that ever changes
      if (type === 'completed' || type === 'canceled' || type === 'cancelled') return 'done';
      if (type === 'started') return 'in-progress';
      return 'planned';
    };

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });

    // Phase 1: Find team by key
    sendSSE(res, 'progress', { phase: 'team' });
    let teamId, teamName;
    try {
      const data = await linearGql('{ teams { nodes { id name key } } }');
      const team = (data.teams?.nodes || []).find(t => t.key.toLowerCase() === teamKey.toLowerCase());
      if (!team) {
        sendSSE(res, 'error', { error: `No team found with key "${teamKey}". Available: ${(data.teams?.nodes || []).map(t => t.key).join(', ') || 'none'}` });
        res.end();
        return;
      }
      teamId = team.id;
      teamName = team.name;
    } catch (e) {
      sendSSE(res, 'error', { error: e.message });
      res.end();
      return;
    }

    // Phase 2: Fetch issues (paginated)
    const ISSUES_QUERY = `query($teamId: ID!, $after: String) {
      issues(filter: { team: { id: { eq: $teamId } } }, first: 100, after: $after) {
        nodes {
          id identifier title description url
          state { name type }
          labels { nodes { name } }
          estimate
          parent { id identifier }
          children { nodes { id } }
          project { id name url }
        }
        pageInfo { hasNextPage endCursor }
      }
    }`;

    const allIssues = [];
    let afterCursor = null;
    const MAX_ISSUES = 10_000;
    try {
      do {
        if (res.destroyed) break;
        const data = await linearGql(ISSUES_QUERY, { teamId, after: afterCursor });
        const page = data.issues;
        allIssues.push(...(page.nodes || []));
        afterCursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
        sendSSE(res, 'progress', { phase: 'issues', fetched: allIssues.length });
      } while (afterCursor && allIssues.length < MAX_ISSUES);
    } catch (e) {
      sendSSE(res, 'error', { phase: 'issues', error: e.message });
      res.end();
      return;
    }

    // Phase 3: Normalize + send
    const issues = allIssues.map(issue => ({
      id: issue.id,
      identifier: issue.identifier,
      summary: issue.title,
      description: issue.description || undefined,
      url: issue.url,
      status: linearStatusToStorymaps(issue.state?.type),
      labels: (issue.labels?.nodes || []).map(l => l.name),
      points: issue.estimate != null ? issue.estimate : undefined,
      parentId: issue.parent?.id || undefined,
      parentIdentifier: issue.parent?.identifier || undefined,
      hasChildren: (issue.children?.nodes || []).length > 0,
      projectId: issue.project?.id || undefined,
      projectName: issue.project?.name || undefined,
      projectUrl: issue.project?.url || undefined
    }));

    // Deduplicate projects from issue data
    const projectMap = new Map();
    for (const issue of issues) {
      if (issue.projectId && !projectMap.has(issue.projectId)) {
        projectMap.set(issue.projectId, {
          id: issue.projectId,
          name: issue.projectName,
          url: issue.projectUrl
        });
      }
    }
    const projects = [...projectMap.values()];

    sendSSE(res, 'done', {
      teamName,
      teamKey,
      issues,
      projects,
      issueCount: issues.length
    });
    res.end();
  });
}
