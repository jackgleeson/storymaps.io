import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import registerLocks from '../server/routes/locks.js';
import registerBackups from '../server/routes/backups.js';

const captureHandlers = (register, extraCtx = {}) => {
  const handlers = {};
  const ctx = {
    route: (method, path, handler) => { handlers[`${method} ${path}`] = handler; },
    isProxyRateLimited: () => false,
    readJson: async () => ({}),
    writeJson: async () => {},
    LOCK_FILE: '/dev/null',
    getBackupFile: () => '/dev/null',
    loadAndSerialize: async () => ({ name: 'x', steps: [] }),
    countCards: () => 0,
    ...extraCtx,
  };
  register(ctx);
  return { handlers, ctx };
};

const fakeRes = () => {
  const out = { status: null, body: null, headers: null };
  return {
    out,
    writeHead(s, h) { out.status = s; out.headers = h; },
    end(b) { out.body = b; },
  };
};

const ratelimited = () => ({ isProxyRateLimited: (req) => req.__shouldLimit === true });

describe('rate-limited routes return 429 when the proxy bucket is full', () => {
  test('POST /api/lock/:mapId/unlock', async () => {
    const { handlers } = captureHandlers(registerLocks, ratelimited());
    const res = fakeRes();
    await handlers['POST /api/lock/:mapId/unlock'](
      { __shouldLimit: true, headers: {} }, res, { mapId: 'abc12345' }, {},
    );
    assert.equal(res.out.status, 429);
  });

  test('POST /api/lock/:mapId/remove', async () => {
    const { handlers } = captureHandlers(registerLocks, ratelimited());
    const res = fakeRes();
    await handlers['POST /api/lock/:mapId/remove'](
      { __shouldLimit: true, headers: {} }, res, { mapId: 'abc12345' }, {},
    );
    assert.equal(res.out.status, 429);
  });

  test('POST /api/backups/:mapId', async () => {
    const { handlers } = captureHandlers(registerBackups, ratelimited());
    const res = fakeRes();
    await handlers['POST /api/backups/:mapId'](
      { __shouldLimit: true, headers: { host: 'localhost' } }, res, { mapId: 'abc12345' }, {},
    );
    assert.equal(res.out.status, 429);
  });

  test('POST /api/backups/:mapId/import', async () => {
    const { handlers } = captureHandlers(registerBackups, ratelimited());
    const res = fakeRes();
    await handlers['POST /api/backups/:mapId/import'](
      { __shouldLimit: true, headers: {} }, res, { mapId: 'abc12345' }, { backups: [] },
    );
    assert.equal(res.out.status, 429);
  });
});

describe('gate does not break the happy path when bucket is OK', () => {
  test('POST /api/lock/:mapId/unlock with default ctx responds 200 when map is not locked', async () => {
    const { handlers } = captureHandlers(registerLocks);
    const res = fakeRes();
    await handlers['POST /api/lock/:mapId/unlock'](
      { headers: {} }, res, { mapId: 'abc12345' }, { passwordHash: 'x' },
    );
    assert.equal(res.out.status, 200);
  });
});
