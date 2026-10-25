import { validateExternalUrl, sendSSE, curlPost } from '../http-helpers.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Map Phabricator task status to storymap status
// Phab statuses: open, stalled -> planned; progress -> in-progress; resolved, declined, invalid, wontfix, duplicate -> done
// fields.status can be an object {value, name} or a string depending on API version
const phabStatusToStorymaps = (statusField) => {
  if (!statusField) return 'planned';
  const s = (typeof statusField === 'string' ? statusField : statusField.value || '').toLowerCase();
  if (!s || s === 'open' || s === 'stalled') return 'planned';
  if (s === 'progress') return 'in-progress';
  return 'done'; // resolved, declined, invalid, wontfix, duplicate
};

export default function register(ctx) {
  const { route } = ctx;
  route('POST', '/api/import/phabricator', async (req, res, params, body) => {
    if (ctx.isProxyRateLimited(req)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Rate limit exceeded. Try again in a minute.' }));
      return;
    }
    const { instanceUrl, token, tags } = body;
    if (!instanceUrl || !token) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing required fields: instanceUrl, token' }));
      return;
    }
    if (!tags || !Array.isArray(tags) || tags.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'At least one project tag is required.' }));
      return;
    }
    if (token.length > 256) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Token too long.' }));
      return;
    }
    const origin = validateExternalUrl(instanceUrl);
    if (!origin) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid instance URL. Must be HTTPS and a public host.' }));
      return;
    }

    let lastCall = 0;
    const conduit = async (method, extraParams = {}) => {
      const elapsed = Date.now() - lastCall;
      if (elapsed < 1000) await sleep(1000 - elapsed);
      const params = new URLSearchParams();
      params.set('api.token', token);
      for (const [k, v] of Object.entries(extraParams)) {
        params.set(k, v);
      }
      const data = await curlPost(`${origin}/api/${method}`, params, 30_000);
      lastCall = Date.now();
      if (data.error_code) throw new Error(data.error_info || 'Conduit API error');
      return data.result;
    };

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });

    // Phase 0: Resolve all project tag slugs to PHIDs
    sendSSE(res, 'progress', { phase: 'project' });
    const projectPHIDs = [];
    try {
      const slugParams = {};
      tags.forEach((tag, i) => { slugParams[`constraints[slugs][${i}]`] = tag; });
      const result = await conduit('project.search', slugParams);
      const projects = result.data || [];
      const resolvedSlugs = new Set();
      for (const p of projects) {
        projectPHIDs.push(p.phid);
        for (const slug of (p.fields?.slugs || [])) resolvedSlugs.add(slug);
        // Also match by name slug (Phabricator normalizes slugs)
        if (p.fields?.slug) resolvedSlugs.add(p.fields.slug);
      }
      const unresolved = tags.filter(t => !resolvedSlugs.has(t) && !projects.some(p => p.fields?.slug === t));
      // If we got fewer projects than tags requested, report unresolved ones
      if (projectPHIDs.length === 0) {
        sendSSE(res, 'error', { phase: 'project', error: `No project tags found. Check the tag slugs in Phabricator: ${tags.join(', ')}` });
        res.end();
        return;
      }
      if (unresolved.length > 0 && projectPHIDs.length < tags.length) {
        sendSSE(res, 'error', { phase: 'project', error: `Project tag(s) not found: ${unresolved.join(', ')}. Check the tag slugs in Phabricator.` });
        res.end();
        return;
      }
    } catch (e) {
      sendSSE(res, 'error', { phase: 'project', error: `Failed to resolve project tags: ${e.message}` });
      res.end();
      return;
    }

    // Phase 1: Fetch tasks - query each project separately for OR logic, deduplicate
    sendSSE(res, 'progress', { phase: 'tasks', fetched: 0 });
    const tasksByPhid = new Map();
    const MAX_TASKS = 10_000;
    try {
      for (const phid of projectPHIDs) {
        let afterCursor = null;
        do {
          if (res.destroyed) break;
          const params = {};
          if (afterCursor) params['after'] = afterCursor;
          params['order'] = 'newest';
          params['limit'] = '100';
          params['attachments[projects]'] = '1';
          params['constraints[projects][0]'] = phid;

          const result = await conduit('maniphest.search', params);
          for (const task of (result.data || [])) {
            if (!tasksByPhid.has(task.phid)) tasksByPhid.set(task.phid, task);
          }
          afterCursor = result.cursor?.after || null;
          sendSSE(res, 'progress', { phase: 'tasks', fetched: tasksByPhid.size });
        } while (afterCursor && tasksByPhid.size < MAX_TASKS);
        if (res.destroyed || tasksByPhid.size >= MAX_TASKS) break;
      }
    } catch (e) {
      sendSSE(res, 'error', { phase: 'tasks', error: e.message });
      res.end();
      return;
    }
    const allTasks = [...tasksByPhid.values()];

    // Phase 2: Normalize tasks
    const tasks = allTasks.map(task => {
      const fields = task.fields || {};
      return {
        id: task.id,
        phid: task.phid,
        identifier: `T${task.id}`,
        summary: fields.name || '',
        description: fields.description?.raw || undefined,
        status: phabStatusToStorymaps(fields.status),
        points: fields.points != null ? Number(fields.points) : undefined,
        parentPhid: fields.subtype === 'default' ? undefined : undefined, // parentage resolved below
        projectPHIDs: task.attachments?.projects?.projectPHIDs || []
      };
    });

    // Phase 3: Find parent-child relationships via subtask edges
    // Fetch parent edges for all tasks (batched)
    sendSSE(res, 'progress', { phase: 'parents', fetched: 0 });
    const taskPhids = tasks.map(t => t.phid);
    const parentMap = new Map(); // child phid -> parent phid
    try {
      // Batch in groups of 100
      for (let i = 0; i < taskPhids.length; i += 100) {
        if (res.destroyed) break;
        const batch = taskPhids.slice(i, i + 100);
        const params = {};
        batch.forEach((phid, idx) => {
          params[`sourcePHIDs[${idx}]`] = phid;
        });
        params['types[0]'] = 'task.parent';
        const result = await conduit('edge.search', params);
        for (const edge of (result.data || [])) {
          parentMap.set(edge.sourcePHID, edge.destinationPHID);
        }
        sendSSE(res, 'progress', { phase: 'parents', fetched: Math.min(i + 100, taskPhids.length) });
      }
    } catch {
      // Parent resolution is best-effort; continue without it
    }

    // Assign parentPhid to tasks
    const phidToTask = new Map();
    for (const task of tasks) {
      phidToTask.set(task.phid, task);
    }
    for (const task of tasks) {
      const pPhid = parentMap.get(task.phid);
      if (pPhid && phidToTask.has(pPhid)) {
        task.parentPhid = pPhid;
        task.parentIdentifier = phidToTask.get(pPhid).identifier;
      }
    }

    // Phase 4: Group each task under its top-level ancestor. Tasks can nest more than two levels
    // deep, so deeper tasks are flattened into the group of the task at the top, and each task
    // appears once. The seen set stops a loop of parent links.
    const rootOf = (task) => {
      const seen = new Set();
      let current = task;
      while (current.parentPhid && !seen.has(current.phid)) {
        seen.add(current.phid);
        current = phidToTask.get(current.parentPhid);
      }
      return current;
    };
    const childrenByRoot = new Map();
    for (const task of tasks) {
      const root = rootOf(task);
      if (root === task) continue;
      if (!childrenByRoot.has(root.phid)) childrenByRoot.set(root.phid, []);
      childrenByRoot.get(root.phid).push(task);
    }
    const toStory = (t) => ({ key: t.identifier, summary: t.summary, description: t.description, status: t.status, points: t.points });

    const epics = [];
    const orphans = [];
    for (const task of tasks) {
      if (rootOf(task) !== task) continue;
      const children = childrenByRoot.get(task.phid);
      if (children) {
        epics.push({
          key: task.identifier,
          summary: task.summary,
          description: task.description,
          status: task.status,
          points: task.points,
          stories: children.map(toStory)
        });
      } else {
        orphans.push(task);
      }
    }

    if (orphans.length > 0) {
      epics.push({ key: null, summary: 'Other', stories: orphans.map(toStory) });
    }

    sendSSE(res, 'done', {
      instanceUrl: origin,
      epics,
      epicCount: epics.length,
      taskCount: tasks.length
    });
    res.end();
  });
}
