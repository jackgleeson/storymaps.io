import { validateExternalUrl, sendSSE, fetchWithTimeout, safeJson } from '../http-helpers.js';

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
    const { instanceUrl, email, token, projectKey, epics } = body;
    if (!instanceUrl || !email || !token || !projectKey || !Array.isArray(epics)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing required fields: instanceUrl, email, token, projectKey, epics' }));
      return;
    }
    const totalStories = epics.reduce((n, e) => n + (e.stories?.length || 0), 0);
    if (epics.length > 200 || totalStories > 2000) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many items. Max 200 epics and 2000 stories.' }));
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
    const headers = { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' };
    const apiUrl = `${origin}/rest/api/3/issue`;
    let created = 0, failed = 0;
    for (const epic of epics) {
      sendSSE(res, 'progress', { type: 'epic', summary: epic.summary, status: 'creating' });
      let epicData;
      try {
        const epicRes = await fetchWithTimeout(apiUrl, {
          method: 'POST', headers,
          body: JSON.stringify({
            fields: {
              project: { key: projectKey },
              summary: epic.summary,
              description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: epic.description || 'Imported from Storymaps.io' }] }] },
              issuetype: { name: 'Epic' }
            }
          })
        });
        epicData = await safeJson(epicRes);
      } catch (e) {
        sendSSE(res, 'progress', { type: 'epic', summary: epic.summary, status: 'error', error: e.message });
        failed += 1 + (epic.stories?.length || 0); // its stories can't be created either
        continue;
      }
      if (epicData.errors || epicData.errorMessages?.length) {
        sendSSE(res, 'progress', { type: 'epic', summary: epic.summary, status: 'error', error: epicData.errors || epicData.errorMessages });
        failed += 1 + (epic.stories?.length || 0);
        continue;
      }
      sendSSE(res, 'progress', { type: 'epic', summary: epic.summary, status: 'created', key: epicData.key });
      created++;
      for (const story of (epic.stories || [])) {
        sendSSE(res, 'progress', { type: 'story', summary: story.summary, parent: epicData.key, status: 'creating' });
        try {
          const storyRes = await fetchWithTimeout(apiUrl, {
            method: 'POST', headers,
            body: JSON.stringify({
              fields: {
                project: { key: projectKey },
                summary: story.summary,
                description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: story.description || 'Imported from Storymaps.io' }] }] },
                issuetype: { name: 'Story' },
                parent: { key: epicData.key }
              }
            })
          });
          const storyData = await safeJson(storyRes);
          if (storyData.errors || storyData.errorMessages?.length) {
            sendSSE(res, 'progress', { type: 'story', summary: story.summary, status: 'error', error: storyData.errors || storyData.errorMessages });
            failed++;
          } else {
            sendSSE(res, 'progress', { type: 'story', summary: story.summary, status: 'created', key: storyData.key });
            created++;
          }
        } catch (e) {
          sendSSE(res, 'progress', { type: 'story', summary: story.summary, status: 'error', error: e.message });
          failed++;
        }
      }
    }
    sendSSE(res, 'done', { created, failed });
    res.end();
  });
}
