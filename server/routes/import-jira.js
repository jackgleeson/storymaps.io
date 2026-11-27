import { validateExternalUrl, sendSSE, fetchWithTimeout, safeJson } from '../http-helpers.js';
import { adfToMarkdown } from '../../src/transfer/markup.js';


// Map Jira statusCategory.key to storymap status
const jiraStatusToStorymaps = (statusCategoryKey) => {
  if (statusCategoryKey === 'done') return 'done';
  if (statusCategoryKey === 'indeterminate') return 'in-progress';
  return 'planned';
};

export default function register(ctx) {
  const { route } = ctx;
  route('POST', '/api/import/jira', async (req, res, params, body) => {
    if (ctx.isProxyRateLimited(req)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Rate limit exceeded. Try again in a minute.' }));
      return;
    }
    const { instanceUrl, email, token, projectKey } = body;
    if (!instanceUrl || !email || !token || !projectKey) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing required fields: instanceUrl, email, token, projectKey' }));
      return;
    }
    if (!/^[A-Z0-9_]{1,50}$/i.test(projectKey)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid projectKey. Must be 1-50 alphanumeric/underscore characters.' }));
      return;
    }
    const origin = validateExternalUrl(instanceUrl);
    if (!origin) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid instance URL. Must be HTTPS and a public host.' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    const auth = Buffer.from(`${email}:${token}`).toString('base64');
    const headers = { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' };
    const searchUrl = `${origin}/rest/api/3/search/jql`;
    const safeKey = projectKey.replace(/[^A-Za-z0-9_]/g, '');
    const MAX_RESULTS = 100;
    const MAX_ISSUES = 10_000;

    // Paginated JQL fetch helper (token-based pagination)
    const fetchAllIssues = async (jql, fields, phase) => {
      const issues = [];
      let nextPageToken = null;
      do {
        const params = new URLSearchParams({
          jql, fields, maxResults: String(MAX_RESULTS)
        });
        if (nextPageToken) params.set('nextPageToken', nextPageToken);
        let data;
        try {
          const r = await fetchWithTimeout(`${searchUrl}?${params}`, { method: 'GET', headers }, 30_000);
          data = await safeJson(r);
        } catch (e) {
          sendSSE(res, 'error', { phase, error: e.message });
          return null;
        }
        if (data.errorMessages?.length) {
          sendSSE(res, 'error', { phase, error: data.errorMessages.join(', ') });
          return null;
        }
        issues.push(...(data.issues || []));
        nextPageToken = data.nextPageToken || null;
        sendSSE(res, 'progress', { phase, fetched: issues.length });
      } while (nextPageToken && issues.length < MAX_ISSUES);
      return issues;
    };

    // Phase 1: Fetch epics
    sendSSE(res, 'progress', { phase: 'epics', fetched: 0 });
    const epics = await fetchAllIssues(
      `project = "${safeKey}" AND issuetype = Epic ORDER BY rank ASC`,
      'summary,description,status,labels,priority',
      'epics'
    );
    if (!epics) { res.end(); return; }

    // Phase 2: Fetch every other issue: stories, tasks, bugs and the rest. Subtasks are left
    // out; they belong to an issue, not to an epic.
    sendSSE(res, 'progress', { phase: 'stories', fetched: 0 });
    const others = await fetchAllIssues(
      `project = "${safeKey}" AND issuetype != Epic ORDER BY rank ASC`,
      'summary,description,status,parent,labels,priority,issuetype,story_points,customfield_10016',
      'stories'
    );
    if (!others) { res.end(); return; }
    const stories = others.filter(issue => !issue.fields.issuetype?.subtask);

    // Phase 3: Group stories under epics
    const epicMap = new Map();
    const epicList = [];
    for (const epic of epics) {
      const epicObj = {
        key: epic.key,
        summary: epic.fields.summary || '',
        description: adfToMarkdown(epic.fields.description),
        status: jiraStatusToStorymaps(epic.fields.status?.statusCategory?.key),
        labels: epic.fields.labels || [],
        stories: []
      };
      epicMap.set(epic.key, epicObj);
      epicList.push(epicObj);
    }

    const orphanStories = [];
    for (const story of stories) {
      const parentKey = story.fields.parent?.key;
      const storyObj = {
        key: story.key,
        summary: story.fields.summary || '',
        type: story.fields.issuetype?.name || 'Story',
        description: adfToMarkdown(story.fields.description),
        status: jiraStatusToStorymaps(story.fields.status?.statusCategory?.key),
        labels: story.fields.labels || [],
        points: ((v) => v != null ? Number(v) : null)(story.fields.story_points ?? story.fields.customfield_10016 ?? null)
      };
      if (parentKey && epicMap.has(parentKey)) {
        epicMap.get(parentKey).stories.push(storyObj);
      } else {
        orphanStories.push(storyObj);
      }
    }

    if (orphanStories.length > 0) {
      epicList.push({
        key: null,
        summary: 'No epic',
        description: '',
        status: 'planned',
        labels: [],
        stories: orphanStories
      });
    }

    sendSSE(res, 'done', { projectKey: safeKey, epics: epicList, epicCount: epicList.length, storyCount: stories.length });
    res.end();
  });
}
