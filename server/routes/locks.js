export default function register(ctx) {
  const { route } = ctx;
  route('GET', '/api/lock/:mapId', async (req, res, { mapId }) => {
    const locks = await ctx.readJson(ctx.LOCK_FILE, {});
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({ isLocked: !!locks[mapId]?.isLocked }));
  });

  route('POST', '/api/lock/:mapId', async (req, res, { mapId }, body) => {
    const locks = await ctx.readJson(ctx.LOCK_FILE, {});
    if (!body.passwordHash) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Password hash required' }));
      return;
    }
    // A locked map only takes a new password from someone who sends the current one,
    // so nobody else can take it over. Locking again with the same password is fine.
    const current = locks[mapId];
    if (current?.isLocked && body.passwordHash !== current.passwordHash && body.currentPasswordHash !== current.passwordHash) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Map is already locked' }));
      return;
    }
    locks[mapId] = {
      isLocked: true,
      passwordHash: body.passwordHash,
      lockedAt: Date.now(),
    };
    await ctx.writeJson(ctx.LOCK_FILE, locks);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({ isLocked: true }));
  });

  route('POST', '/api/lock/:mapId/unlock', async (req, res, { mapId }, body) => {
    if (ctx.isProxyRateLimited(req)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many attempts' }));
      return;
    }
    const locks = await ctx.readJson(ctx.LOCK_FILE, {});
    const lock = locks[mapId];
    if (!lock?.isLocked) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    const ok = body.passwordHash === lock.passwordHash;
    res.writeHead(ok ? 200 : 403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok }));
  });

  route('POST', '/api/lock/:mapId/remove', async (req, res, { mapId }, body) => {
    if (ctx.isProxyRateLimited(req)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many attempts' }));
      return;
    }
    const locks = await ctx.readJson(ctx.LOCK_FILE, {});
    const lock = locks[mapId];
    if (!lock?.isLocked) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (body.passwordHash !== lock.passwordHash) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Incorrect password' }));
      return;
    }
    delete locks[mapId];
    await ctx.writeJson(ctx.LOCK_FILE, locks);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
}
