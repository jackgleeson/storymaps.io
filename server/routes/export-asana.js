import { sendSSE, fetchWithTimeout, safeJson } from '../http-helpers.js';
import { cleanIssues, invalidIssues, createEach, errorText, uniqueLabels } from '../export-issues.js';

export default function register(ctx) {
  const { route } = ctx;
  route('POST', '/api/export/asana/verify', async (req, res, params, body) => {
    if (ctx.isProxyRateLimited(req)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Rate limit exceeded. Try again in a minute.' }));
      return;
    }
    const { token } = body;
    if (!token) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Missing required field: token' }));
      return;
    }
    try {
      const r = await fetchWithTimeout('https://app.asana.com/api/1.0/users/me', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
      }, 10_000);
      const data = await safeJson(r);
      if (r.status === 401 || r.status === 403 || data.errors?.length) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: data.errors?.[0]?.message || 'Authentication failed' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, name: data.data?.name || data.data?.email || 'Unknown' }));
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: `Connection failed: ${e.message}` }));
    }
  });

  route('POST', '/api/export/asana', async (req, res, params, body) => {
    if (ctx.isProxyRateLimited(req)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Rate limit exceeded. Try again in a minute.' }));
      return;
    }
    const { token: asanaToken, projectGid } = body;
    if (!asanaToken || !projectGid) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing required fields: token, projectGid' }));
      return;
    }
    if (!/^\d+$/.test(projectGid)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid projectGid. Must be numeric.' }));
      return;
    }
    const issues = cleanIssues(body.issues);
    if (!issues) return invalidIssues(res);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    const baseUrl = 'https://app.asana.com/api/1.0';
    const headers = { 'Authorization': `Bearer ${asanaToken}`, 'Content-Type': 'application/json', 'Accept': 'application/json' };
    const asana = async (method, path, data) => {
      const r = await fetchWithTimeout(`${baseUrl}${path}`, { method, headers, ...(data && { body: JSON.stringify({ data }) }) });
      const json = await safeJson(r);
      if (json.errors) throw new Error(errorText(json.errors[0]?.message || json.errors));
      return json.data;
    };

    // Labels are Asana tags, which belong to the workspace the project is in. Use a tag with
    // the same name when there is one, and make the rest. A tag that can't be found or made
    // is left off; the task is still created.
    const tagGids = new Map();
    const wanted = uniqueLabels(issues);
    if (wanted.length) {
      sendSSE(res, 'progress', { type: 'labels', status: 'creating', count: wanted.length });
      let workspace;
      try {
        workspace = (await asana('GET', `/projects/${projectGid}?opt_fields=workspace`)).workspace?.gid;
      } catch (e) {
        sendSSE(res, 'done', { created: 0, failed: 0, error: errorText(e.message) });
        res.end();
        return;
      }
      for (const name of workspace ? wanted : []) {
        try {
          const found = await asana('GET', `/workspaces/${workspace}/typeahead?resource_type=tag&count=20&opt_fields=name&query=${encodeURIComponent(name)}`);
          const tag = (found || []).find(t => (t.name || '').toLowerCase() === name.toLowerCase())
            || await asana('POST', `/workspaces/${workspace}/tags`, { name });
          if (tag?.gid) tagGids.set(name, tag.gid);
        } catch { /* left off */ }
      }
    }

    await createEach(res, issues, async (issue) => {
      const data = { name: issue.title, notes: issue.description, projects: [projectGid], completed: issue.status === 'done' };
      const tags = issue.labels.map(name => tagGids.get(name)).filter(Boolean);
      if (tags.length) data.tags = tags;
      const task = await asana('POST', '/tasks', data);
      const missing = issue.labels.length - tags.length;
      return { gid: task.gid, ...(missing > 0 && { note: `${missing} tag${missing === 1 ? '' : 's'} left off` }) };
    });
  });
}
