import { sendSSE, fetchWithTimeout, safeJson } from '../http-helpers.js';
import { htmlToMarkdown } from '../../src/transfer/markup.js';

// A task's notes as Markdown: from its formatted notes where Asana sends them, else its plain ones
const asanaNotes = (task) => (task.html_notes ? htmlToMarkdown(task.html_notes, { newLines: true }) : (task.notes || '').trim());

export default function register(ctx) {
  const { route } = ctx;
  route('POST', '/api/import/asana', async (req, res, params, body) => {
    if (ctx.isProxyRateLimited(req)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Rate limit exceeded. Try again in a minute.' }));
      return;
    }
    const { token, projectGid } = body;
    if (!token || !projectGid) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing required fields: token, projectGid' }));
      return;
    }
    if (token.length > 256) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Token too long.' }));
      return;
    }
    if (!/^\d+$/.test(projectGid)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid projectGid. Must be numeric.' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    const asanaHeaders = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };
    const BASE = 'https://app.asana.com/api/1.0';

    // Phase 1: Fetch project name
    sendSSE(res, 'progress', { phase: 'project', fetched: 0 });
    let projectName;
    try {
      const r = await fetchWithTimeout(`${BASE}/projects/${projectGid}?opt_fields=name`, { method: 'GET', headers: asanaHeaders }, 15_000);
      const data = await safeJson(r);
      if (data.errors?.length) {
        sendSSE(res, 'error', { phase: 'project', error: data.errors[0].message });
        res.end();
        return;
      }
      projectName = data.data?.name || 'Asana Project';
    } catch (e) {
      sendSSE(res, 'error', { phase: 'project', error: e.message });
      res.end();
      return;
    }

    // Phase 2: Fetch all top-level tasks (paginated)
    sendSSE(res, 'progress', { phase: 'tasks', fetched: 0 });
    const allTasks = [];
    let offset = null;
    const MAX_TASKS = 10_000;
    const MAX_SUBTASKS = 50_000;
    try {
      do {
        if (res.destroyed) break;
        const params = new URLSearchParams({
          project: projectGid,
          limit: '100',
          opt_fields: 'name,notes,html_notes,completed,num_subtasks,gid,memberships.section.gid,memberships.section.name'
        });
        if (offset) params.set('offset', offset);
        const r = await fetchWithTimeout(`${BASE}/tasks?${params}`, { method: 'GET', headers: asanaHeaders }, 30_000);
        const data = await safeJson(r);
        if (data.errors?.length) {
          sendSSE(res, 'error', { phase: 'tasks', error: data.errors[0].message });
          res.end();
          return;
        }
        allTasks.push(...(data.data || []));
        offset = data.next_page?.offset || null;
        sendSSE(res, 'progress', { phase: 'tasks', fetched: allTasks.length });
      } while (offset && allTasks.length < MAX_TASKS);
    } catch (e) {
      sendSSE(res, 'error', { phase: 'tasks', error: e.message });
      res.end();
      return;
    }

    // Phase 2.5: Fetch project sections (non-fatal)
    sendSSE(res, 'progress', { phase: 'sections', fetched: 0 });
    const sections = [];
    try {
      const r = await fetchWithTimeout(
        `${BASE}/projects/${projectGid}/sections?opt_fields=name&limit=100`,
        { method: 'GET', headers: asanaHeaders }, 15_000
      );
      const data = await safeJson(r);
      if (!data.errors?.length) {
        for (const s of (data.data || [])) {
          sections.push({ gid: s.gid, name: s.name });
        }
      }
    } catch { /* non-fatal - sections toggle just won't appear */ }

    // Phase 3: For each task with subtasks, fetch its subtasks
    sendSSE(res, 'progress', { phase: 'subtasks', fetched: 0 });
    const epicList = [];
    let subtaskTotal = 0;
    for (const task of allTasks) {
      if (res.destroyed) break;
      const membership = (task.memberships || []).find(m => m.section?.gid);
      const epic = {
        key: task.gid || '',
        summary: task.name || '',
        description: asanaNotes(task) || undefined,
        status: task.completed ? 'done' : 'planned',
        sectionGid: membership?.section?.gid || '',
        sectionName: membership?.section?.name || '',
        stories: []
      };

      if (task.num_subtasks > 0 && /^\d+$/.test(task.gid) && subtaskTotal < MAX_SUBTASKS) {
        try {
          let subOffset = null;
          do {
            const params = new URLSearchParams({
              limit: '100',
              opt_fields: 'name,notes,html_notes,completed,gid'
            });
            if (subOffset) params.set('offset', subOffset);
            const r = await fetchWithTimeout(`${BASE}/tasks/${task.gid}/subtasks?${params}`, { method: 'GET', headers: asanaHeaders }, 30_000);
            const data = await safeJson(r);
            if (data.errors?.length) break;
            for (const sub of (data.data || [])) {
              epic.stories.push({
                key: sub.gid || '',
                summary: sub.name || '',
                description: asanaNotes(sub) || undefined,
                status: sub.completed ? 'done' : 'planned'
              });
            }
            subOffset = data.next_page?.offset || null;
          } while (subOffset && subtaskTotal + epic.stories.length < MAX_SUBTASKS);
          subtaskTotal += epic.stories.length;
          sendSSE(res, 'progress', { phase: 'subtasks', fetched: subtaskTotal });
        } catch { /* skip subtask fetch errors, keep task with empty stories */ }
      }

      epicList.push(epic);
    }

    sendSSE(res, 'done', {
      projectName,
      epics: epicList,
      sections,
      taskCount: allTasks.length,
      subtaskCount: subtaskTotal
    });
    res.end();
  });
}
