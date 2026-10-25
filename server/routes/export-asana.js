import { sendSSE, fetchWithTimeout, safeJson } from '../http-helpers.js';

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
    const { token: asanaToken, projectGid, createSections, items } = body;
    if (!asanaToken || !projectGid || !Array.isArray(items)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing required fields: token, projectGid, items' }));
      return;
    }
    if (!/^\d+$/.test(projectGid)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid projectGid. Must be numeric.' }));
      return;
    }
    const totalSubtasks = items.reduce((n, it) => n + (it.subtasks?.length || 0), 0);
    if (items.length > 200 || totalSubtasks > 2000) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many items. Max 200 items and 2000 subtasks.' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    const baseUrl = 'https://app.asana.com/api/1.0';
    const headers = { 'Authorization': `Bearer ${asanaToken}`, 'Content-Type': 'application/json' };
    let created = 0, failed = 0;
    for (const item of items) {
      let sectionGid = null;
      if (createSections) {
        sendSSE(res, 'progress', { type: 'section', name: item.name, status: 'creating' });
        try {
          const secRes = await fetchWithTimeout(`${baseUrl}/projects/${projectGid}/sections`, {
            method: 'POST', headers,
            body: JSON.stringify({ data: { name: item.name } })
          });
          const secData = await safeJson(secRes);
          if (secData.errors) {
            sendSSE(res, 'progress', { type: 'section', name: item.name, status: 'error', error: secData.errors });
          } else {
            sectionGid = secData.data.gid;
            sendSSE(res, 'progress', { type: 'section', name: item.name, status: 'created' });
          }
        } catch (e) {
          sendSSE(res, 'progress', { type: 'section', name: item.name, status: 'error', error: e.message });
        }
      }
      sendSSE(res, 'progress', { type: 'task', name: item.name, status: 'creating' });
      let taskData;
      try {
        const taskBody = {
          data: {
            name: item.name,
            notes: item.notes || 'Imported from Storymaps.io',
            projects: [projectGid],
            completed: item.completed || false
          }
        };
        if (sectionGid) {
          taskBody.data.memberships = [{ project: projectGid, section: sectionGid }];
        }
        const taskRes = await fetchWithTimeout(`${baseUrl}/tasks`, { method: 'POST', headers, body: JSON.stringify(taskBody) });
        taskData = await safeJson(taskRes);
      } catch (e) {
        sendSSE(res, 'progress', { type: 'task', name: item.name, status: 'error', error: e.message });
        failed += 1 + (item.subtasks?.length || 0); // its subtasks can't be created either
        continue;
      }
      if (taskData.errors) {
        sendSSE(res, 'progress', { type: 'task', name: item.name, status: 'error', error: taskData.errors });
        failed += 1 + (item.subtasks?.length || 0);
        continue;
      }
      const parentGid = taskData.data.gid;
      sendSSE(res, 'progress', { type: 'task', name: item.name, status: 'created', gid: parentGid });
      created++;
      for (const sub of (item.subtasks || [])) {
        sendSSE(res, 'progress', { type: 'subtask', name: sub.name, parent: parentGid, status: 'creating' });
        try {
          const subRes = await fetchWithTimeout(`${baseUrl}/tasks/${parentGid}/subtasks`, {
            method: 'POST', headers,
            body: JSON.stringify({
              data: {
                name: sub.name,
                notes: sub.notes || 'Imported from Storymaps.io',
                completed: sub.completed || false
              }
            })
          });
          const subData = await safeJson(subRes);
          if (subData.errors) {
            sendSSE(res, 'progress', { type: 'subtask', name: sub.name, status: 'error', error: subData.errors });
            failed++;
          } else {
            sendSSE(res, 'progress', { type: 'subtask', name: sub.name, status: 'created', gid: subData.data.gid });
            created++;
          }
        } catch (e) {
          sendSSE(res, 'progress', { type: 'subtask', name: sub.name, status: 'error', error: e.message });
          failed++;
        }
      }
    }
    sendSSE(res, 'done', { created, failed });
    res.end();
  });
}
