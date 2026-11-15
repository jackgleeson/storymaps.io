import { validateExternalUrl, fetchWithTimeout, safeJson } from '../http-helpers.js';
import { cleanIssues, invalidIssues, createEach, errorText, toAdf } from '../export-issues.js';

export default function register(ctx) {
  const { route } = ctx;
  route('POST', '/api/export/jira/verify', async (req, res, params, body) => {
    if (ctx.isProxyRateLimited(req)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Rate limit exceeded. Try again in a minute.' }));
      return;
    }
    const { instanceUrl, email, token } = body;
    if (!instanceUrl || !email || !token) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Missing required fields: instanceUrl, email, token' }));
      return;
    }
    const origin = validateExternalUrl(instanceUrl);
    if (!origin) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid instance URL. Must be HTTPS and a public host.' }));
      return;
    }
    try {
      const auth = Buffer.from(`${email}:${token}`).toString('base64');
      const r = await fetchWithTimeout(`${origin}/rest/api/3/myself`, {
        method: 'GET',
        headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
      }, 10_000);
      const data = await safeJson(r);
      if (r.status === 401 || r.status === 403 || data.errorMessages?.length) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: data.errorMessages?.[0] || 'Authentication failed' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, displayName: data.displayName || data.emailAddress || 'Unknown' }));
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: `Connection failed: ${e.message}` }));
    }
  });

  route('POST', '/api/export/jira', async (req, res, params, body) => {
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
    const issues = cleanIssues(body.issues);
    if (!issues) return invalidIssues(res);
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
    const headers = { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json', 'Accept': 'application/json' };
    const apiUrl = `${origin}/rest/api/3/issue`;

    // Some Jira projects have no Story work type, or keep Labels off the create screen. When
    // Jira says so, carry on without, for this issue and the ones after it.
    let issueType = 'Story';
    let sendLabels = true;
    const createIssue = async (issue) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const fields = { project: { key: projectKey }, summary: issue.title, issuetype: { name: issueType } };
        const description = toAdf(issue.description);
        if (description) fields.description = description;
        if (sendLabels && issue.labels.length) fields.labels = issue.labels;
        const r = await fetchWithTimeout(apiUrl, { method: 'POST', headers, body: JSON.stringify({ fields }) });
        const data = await safeJson(r);
        if (data.key) return data;
        const errors = data.errors || {};
        if (errors.issuetype && issueType === 'Story') { issueType = 'Task'; continue; }
        if (errors.labels && sendLabels) { sendLabels = false; continue; }
        throw new Error(errorText(Object.keys(errors).length ? errors : data.errorMessages?.length ? data.errorMessages : `HTTP ${r.status}`));
      }
      throw new Error('Jira would not create the issue');
    };

    // A new issue starts in the first status of the workflow. Cards that are in progress or
    // done are moved on with a transition, found once and reused. Failing to move an issue
    // does not fail the issue.
    const CATEGORY = { 'in-progress': 'indeterminate', done: 'done' };
    const NAME = { 'in-progress': /^in progress$/i, done: /^done$/i };
    const transitionIds = {};
    const moveIssue = async (key, status) => {
      if (!CATEGORY[status]) return true;
      const url = `${apiUrl}/${encodeURIComponent(key)}/transitions`;
      try {
        if (!(status in transitionIds)) {
          const data = await safeJson(await fetchWithTimeout(url, { method: 'GET', headers }));
          const matches = (data.transitions || []).filter(t => t.to?.statusCategory?.key === CATEGORY[status]);
          transitionIds[status] = (matches.find(t => NAME[status].test(t.to?.name || '')) || matches[0])?.id ?? null;
        }
        if (!transitionIds[status]) return false;
        const r = await fetchWithTimeout(url, { method: 'POST', headers, body: JSON.stringify({ transition: { id: transitionIds[status] } }) });
        return r.status >= 200 && r.status < 300;
      } catch {
        return false;
      }
    };

    await createEach(res, issues, async (issue) => {
      const data = await createIssue(issue);
      const moved = await moveIssue(data.key, issue.status);
      const notes = [];
      if (!sendLabels && issue.labels.length) notes.push('no labels');
      if (!moved) notes.push('status not set');
      return { key: data.key, ...(notes.length && { note: notes.join(', ') }) };
    });
  });
}
