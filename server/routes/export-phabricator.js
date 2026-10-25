import { validateExternalUrl, sendSSE, curlPost } from '../http-helpers.js';

export default function register(ctx) {
  const { route } = ctx;
  route('POST', '/api/export/phabricator/verify', async (req, res, params, body) => {
    if (ctx.isProxyRateLimited(req)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Rate limit exceeded. Try again in a minute.' }));
      return;
    }
    const { instanceUrl, token } = body;
    if (!instanceUrl || !token) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Missing required fields: instanceUrl, token' }));
      return;
    }
    const origin = validateExternalUrl(instanceUrl);
    if (!origin) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid instance URL. Must be HTTPS and a public host.' }));
      return;
    }
    try {
      const params = new URLSearchParams();
      params.set('api.token', token);
      const data = await curlPost(`${origin}/api/user.whoami`, params, 10_000);
      if (data.error_code) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: data.error_info || 'Authentication failed' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, userName: data.result?.userName || data.result?.realName || 'Unknown' }));
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: `Connection failed: ${e.message}` }));
    }
  });

  route('POST', '/api/export/phabricator', async (req, res, params, body) => {
    if (ctx.isProxyRateLimited(req)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Rate limit exceeded. Try again in a minute.' }));
      return;
    }
    const { instanceUrl, token: phabToken, tags, items } = body;
    if (!instanceUrl || !phabToken || !Array.isArray(items)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing required fields: instanceUrl, token, items' }));
      return;
    }
    const totalSubtasks = items.reduce((n, it) => n + (it.subtasks?.length || 0), 0);
    if (items.length > 200 || totalSubtasks > 2000) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many items. Max 200 items and 2000 subtasks.' }));
      return;
    }
    const origin = validateExternalUrl(instanceUrl);
    if (!origin) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid instance URL. Must be HTTPS and a public host.' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    const apiUrl = `${origin}/api/maniphest.edit`;
    const phabStatusMap = { none: 'open', planned: 'open', 'in-progress': 'progress', done: 'resolved' };
    const userTags = Array.isArray(tags) ? tags : [];
    let created = 0, failed = 0;
    for (const item of items) {
      sendSSE(res, 'progress', { type: 'task', title: item.title, status: 'creating' });
      const txnParams = new URLSearchParams();
      txnParams.set('api.token', phabToken);
      let i = 0;
      txnParams.set(`transactions[${i}][type]`, 'title');
      txnParams.set(`transactions[${i++}][value]`, item.title);
      txnParams.set(`transactions[${i}][type]`, 'description');
      txnParams.set(`transactions[${i++}][value]`, item.description || '');
      if (item.status) {
        txnParams.set(`transactions[${i}][type]`, 'status');
        txnParams.set(`transactions[${i++}][value]`, phabStatusMap[item.status] || 'open');
      }
      const itemTags = item.type === 'epic' ? ['epic', ...userTags] : [...userTags];
      if (itemTags.length) {
        txnParams.set(`transactions[${i}][type]`, 'projects.add');
        itemTags.forEach((tag, j) => txnParams.set(`transactions[${i}][value][${j}]`, tag));
        i++;
      }
      let parentData;
      try {
        parentData = await curlPost(apiUrl, txnParams);
      } catch (e) {
        sendSSE(res, 'progress', { type: 'task', title: item.title, status: 'error', error: e.message });
        failed += 1 + (item.subtasks?.length || 0); // its subtasks can't be created either
        continue;
      }
      if (parentData.error_code) {
        sendSSE(res, 'progress', { type: 'task', title: item.title, status: 'error', error: parentData.error_info });
        failed += 1 + (item.subtasks?.length || 0);
        continue;
      }
      const parentPhid = parentData.result.object.phid;
      const parentId = parentData.result.object.id;
      sendSSE(res, 'progress', { type: 'task', title: item.title, status: 'created', id: `T${parentId}` });
      created++;
      for (const sub of (item.subtasks || [])) {
        sendSSE(res, 'progress', { type: 'subtask', title: sub.title, parent: `T${parentId}`, status: 'creating' });
        try {
          const subParams = new URLSearchParams();
          subParams.set('api.token', phabToken);
          let si = 0;
          subParams.set(`transactions[${si}][type]`, 'title');
          subParams.set(`transactions[${si++}][value]`, sub.title);
          subParams.set(`transactions[${si}][type]`, 'description');
          subParams.set(`transactions[${si++}][value]`, sub.description || '');
          if (sub.status) {
            subParams.set(`transactions[${si}][type]`, 'status');
            subParams.set(`transactions[${si++}][value]`, phabStatusMap[sub.status] || 'open');
          }
          subParams.set(`transactions[${si}][type]`, 'parent');
          subParams.set(`transactions[${si++}][value]`, parentPhid);
          if (userTags.length) {
            subParams.set(`transactions[${si}][type]`, 'projects.add');
            userTags.forEach((tag, j) => subParams.set(`transactions[${si}][value][${j}]`, tag));
          }
          const subData = await curlPost(apiUrl, subParams);
          if (subData.error_code) {
            sendSSE(res, 'progress', { type: 'subtask', title: sub.title, status: 'error', error: subData.error_info });
            failed++;
          } else {
            sendSSE(res, 'progress', { type: 'subtask', title: sub.title, status: 'created', id: `T${subData.result.object.id}` });
            created++;
          }
        } catch (e) {
          sendSSE(res, 'progress', { type: 'subtask', title: sub.title, status: 'error', error: e.message });
          failed++;
        }
      }
    }
    sendSSE(res, 'done', { created, failed });
    res.end();
  });
}
