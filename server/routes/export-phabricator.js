import { validateExternalUrl, curlPost } from '../http-helpers.js';
import { cleanIssues, invalidIssues, createEach } from '../export-issues.js';

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
    const { instanceUrl, token: phabToken, tags } = body;
    if (!instanceUrl || !phabToken) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing required fields: instanceUrl, token' }));
      return;
    }
    const issues = cleanIssues(body.issues);
    if (!issues) return invalidIssues(res);
    const origin = validateExternalUrl(instanceUrl);
    if (!origin) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid instance URL. Must be HTTPS and a public host.' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    const apiUrl = `${origin}/api/maniphest.edit`;
    const phabStatus = { none: 'open', planned: 'open', 'in-progress': 'progress', blocked: 'stalled', done: 'resolved' };
    // Phabricator tags are projects that must already exist, so only the ones typed into the
    // export window are added. The slice and the step are lines in the description.
    const userTags = Array.isArray(tags) ? tags.filter(t => typeof t === 'string' && t).slice(0, 50) : [];
    await createEach(res, issues, async (issue) => {
      const txn = new URLSearchParams();
      txn.set('api.token', phabToken);
      let i = 0;
      txn.set(`transactions[${i}][type]`, 'title');
      txn.set(`transactions[${i++}][value]`, issue.title);
      txn.set(`transactions[${i}][type]`, 'description');
      txn.set(`transactions[${i++}][value]`, issue.description);
      txn.set(`transactions[${i}][type]`, 'status');
      txn.set(`transactions[${i++}][value]`, phabStatus[issue.status]);
      if (userTags.length) {
        txn.set(`transactions[${i}][type]`, 'projects.add');
        userTags.forEach((tag, j) => txn.set(`transactions[${i}][value][${j}]`, tag));
      }
      const data = await curlPost(apiUrl, txn);
      if (data.error_code) throw new Error(data.error_info || data.error_code);
      return { id: `T${data.result.object.id}` };
    });
  });
}
