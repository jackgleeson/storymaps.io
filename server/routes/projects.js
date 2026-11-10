import { ProjectError } from '../projects.js';

// Projects, reached by their own ID. Changes are only accepted from the site itself (the origin
// check), not from the CLI.
export default function register(ctx) {
  const { route, projects } = ctx;

  const send = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  // The app sends a SHA-256 of the password, as hex
  const isHash = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

  // Each locked map says whether it shares the project password. The passwords stay here.
  const withMapLocks = async (project) => {
    if (!project) return project;
    const locks = await ctx.readJson(ctx.LOCK_FILE, {});
    const hash = projects.passwordHash(project.id);
    return {
      ...project,
      maps: project.maps.map(map => (locks[map.id]?.isLocked
        ? { ...map, lock: locks[map.id].passwordHash === hash ? 'project' : 'map' }
        : map)),
    };
  };

  const refuse = (res, err) => {
    if (err instanceof ProjectError) return send(res, err.status, { error: err.message });
    console.error('Project route error:', err);
    send(res, 500, { error: 'Something went wrong. Try again.' });
  };

  // Run a store call and answer with the project it returns
  const answer = async (res, fn, status = 200, onLocked) => {
    try {
      send(res, status, { project: await withMapLocks(fn()) });
    } catch (err) {
      if (err instanceof ProjectError && err.status === 423) onLocked?.();
      refuse(res, err);
    }
  };

  const limited = (req, res, check) => {
    if (!check(req)) return false;
    send(res, 429, { error: 'Too many changes. Try again in a minute.' });
    return true;
  };

  route('POST', '/api/projects', async (req, res, params, body) => {
    if (limited(req, res, ctx.isCreateRateLimited)) return;
    await answer(res, () => projects.create(body?.mapIds, body?.name), 201);
  });

  route('GET', '/api/projects/:id', async (req, res, { id }) => {
    await answer(res, () => {
      const project = projects.get(id);
      if (!project) throw new ProjectError(404, 'Project not found');
      return project;
    });
  });

  // Deleting a project answers with project: null
  const write = (path, fn) => route('POST', path, async (req, res, { id }, body) => {
    if (limited(req, res, ctx.isRateLimited)) return;
    const withPassword = typeof body?.lockPasswordHash === 'string';
    if (withPassword && limited(req, res, ctx.isPasswordLimited)) return;
    await answer(res, () => fn(id, body || {}), 200, () => { if (withPassword) ctx.countWrongPassword(req); });
  });

  // A change to a locked project needs its password
  const guarded = (fn) => (id, body) => {
    projects.assertEditable(id, body.lockPasswordHash);
    return fn(id, body);
  };

  write('/api/projects/:id/maps', guarded((id, body) => projects.add(id, body.mapId, body.after)));
  write('/api/projects/:id/remove', guarded((id, body) => projects.remove(id, body.mapId)));
  write('/api/projects/:id/order', guarded((id, body) => projects.reorder(id, body.mapIds)));
  write('/api/projects/:id/name', guarded((id, body) => projects.rename(id, body.name)));
  write('/api/projects/:id/delete', guarded((id) => projects.destroy(id)));

  // Limited by wrong passwords only, so someone with the password can work through a project's maps
  const lockRoute = (path, fn) => route('POST', path, async (req, res, { id }, body) => {
    if (limited(req, res, ctx.isPasswordLimited)) return;
    if (!isHash(body?.passwordHash) || (body.currentPasswordHash != null && !isHash(body.currentPasswordHash))) {
      return send(res, 400, { error: 'Password hash required' });
    }
    try {
      send(res, 200, await fn(id, body));
    } catch (err) {
      if (err instanceof ProjectError && err.status === 403) ctx.countWrongPassword(req);
      refuse(res, err);
    }
  });

  // Locks the project and, if asked, every map in it that isn't locked. All in one request, as
  // per-map calls would use up the limit above. A map with another password is left as it is.
  lockRoute('/api/projects/:id/lock', async (id, body) => {
    projects.lock(id, body.passwordHash, body.currentPasswordHash);
    const skipped = [];
    if (body.lockMaps === true) {
      await ctx.updateJson(ctx.LOCK_FILE, {}, (locks) => {
        for (const mapId of projects.memberIds(id)) {
          if (!locks[mapId]?.isLocked) locks[mapId] = { isLocked: true, passwordHash: body.passwordHash, lockedAt: Date.now() };
          else if (locks[mapId].passwordHash !== body.passwordHash) skipped.push(mapId);
        }
      });
    }
    return { project: await withMapLocks(projects.get(id)), skipped };
  });

  // Locks a map with the project password, or removes a map lock with that lock's own password
  lockRoute('/api/projects/:id/map-lock', async (id, body) => {
    const { mapId, action, passwordHash } = body;
    if (!projects.memberIds(id).includes(mapId)) throw new ProjectError(404, 'That map is not in this project');
    if (action === 'lock') {
      projects.checkPassword(id, passwordHash);
      let taken = false;
      await ctx.updateJson(ctx.LOCK_FILE, {}, (locks) => {
        if (locks[mapId]?.isLocked) {
          taken = locks[mapId].passwordHash !== passwordHash;
          return false;
        }
        locks[mapId] = { isLocked: true, passwordHash, lockedAt: Date.now() };
      });
      if (taken) throw new ProjectError(409, 'That map already has a different lock');
    } else if (action === 'unlock') {
      let wrong = false;
      await ctx.updateJson(ctx.LOCK_FILE, {}, (locks) => {
        if (!locks[mapId]?.isLocked) return false;
        if (locks[mapId].passwordHash !== passwordHash) {
          wrong = true;
          return false;
        }
        delete locks[mapId];
      });
      if (wrong) throw new ProjectError(403, 'Incorrect password');
    } else {
      throw new ProjectError(400, 'Choose lock or unlock');
    }
    return { project: await withMapLocks(projects.get(id)) };
  });

  lockRoute('/api/projects/:id/unlock', async (id, body) => ({
    project: await withMapLocks(projects.checkPassword(id, body.passwordHash)),
  }));

  // Removes the project lock and, if asked, the map locks with the same password
  lockRoute('/api/projects/:id/lock/remove', async (id, body) => {
    projects.unlock(id, body.passwordHash);
    if (body.removeMaps === true) {
      await ctx.updateJson(ctx.LOCK_FILE, {}, (locks) => {
        for (const mapId of projects.memberIds(id)) {
          if (locks[mapId]?.isLocked && locks[mapId].passwordHash === body.passwordHash) delete locks[mapId];
        }
      });
    }
    return { project: await withMapLocks(projects.get(id)) };
  });
}
