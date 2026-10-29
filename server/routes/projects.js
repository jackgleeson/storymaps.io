import { ProjectError } from '../projects.js';

// Projects, reached by their own ID. Changes are only accepted from the site itself (the origin
// check), not from the CLI.
export default function register(ctx) {
  const { route, projects } = ctx;

  const send = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  // Run a store call and answer with the project it returns
  const answer = (res, fn, status = 200) => {
    let project;
    try {
      project = fn();
    } catch (err) {
      if (err instanceof ProjectError) return send(res, err.status, { error: err.message });
      console.error('Project route error:', err);
      return send(res, 500, { error: 'Something went wrong. Try again.' });
    }
    send(res, status, { project });
  };

  const limited = (req, res, check) => {
    if (!check(req)) return false;
    send(res, 429, { error: 'Too many changes. Try again in a minute.' });
    return true;
  };

  route('POST', '/api/projects', async (req, res, params, body) => {
    if (limited(req, res, ctx.isCreateRateLimited)) return;
    answer(res, () => projects.create(body?.mapIds, body?.name), 201);
  });

  route('GET', '/api/projects/:id', async (req, res, { id }) => {
    answer(res, () => {
      const project = projects.get(id);
      if (!project) throw new ProjectError(404, 'Project not found');
      return project;
    });
  });

  // Deleting a project answers with project: null
  const write = (path, fn) => route('POST', path, async (req, res, { id }, body) => {
    if (limited(req, res, ctx.isRateLimited)) return;
    answer(res, () => fn(id, body || {}));
  });

  write('/api/projects/:id/maps', (id, body) => projects.add(id, body.mapId, body.after));
  write('/api/projects/:id/remove', (id, body) => projects.remove(id, body.mapId));
  write('/api/projects/:id/order', (id, body) => projects.reorder(id, body.mapIds));
  write('/api/projects/:id/name', (id, body) => projects.rename(id, body.name));
  write('/api/projects/:id/delete', (id) => projects.destroy(id));
}
