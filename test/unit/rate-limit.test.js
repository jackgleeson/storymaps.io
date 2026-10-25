import { describe, test, beforeEach, afterEach, mock } from 'node:test';
import { strict as assert } from 'node:assert';

// Limit by the socket address, whatever the dev shell sets
delete process.env.TRUST_PROXY;
const { isRateLimited, isProxyRateLimited, isCreateRateLimited } = await import('../../server/rate-limit.js');

// The limiters keep their counts for the whole run, so every test uses its own IP
let ipCounter = 0;
const newClient = () => ({ socket: { remoteAddress: `198.51.100.${++ipCounter}` }, headers: {} });

const sendRequests = (limiter, req, count) =>
  Array.from({ length: count }, () => limiter(req));

describe('rate limits', () => {
  beforeEach(() => mock.timers.enable({ apis: ['Date'], now: 1_000_000 }));
  afterEach(() => mock.timers.reset());

  test('allows 30 API requests a minute, then limits', () => {
    const req = newClient();
    assert.ok(sendRequests(isRateLimited, req, 30).every(limited => !limited));
    assert.equal(isRateLimited(req), true);
  });

  test('allows 5 proxy requests a minute, then limits', () => {
    const req = newClient();
    assert.ok(sendRequests(isProxyRateLimited, req, 5).every(limited => !limited));
    assert.equal(isProxyRateLimited(req), true);
  });

  test('allows requests again once the minute has passed', () => {
    const req = newClient();
    sendRequests(isProxyRateLimited, req, 5);
    assert.equal(isProxyRateLimited(req), true);
    mock.timers.tick(59_999);
    assert.equal(isProxyRateLimited(req), true, 'still limited just before the minute is up');
    mock.timers.tick(1);
    assert.equal(isProxyRateLimited(req), false);
  });

  test('limited requests do not count towards the limit', () => {
    const req = newClient();
    sendRequests(isProxyRateLimited, req, 5);
    mock.timers.tick(30_000);
    sendRequests(isProxyRateLimited, req, 10);
    mock.timers.tick(30_000);
    assert.equal(isProxyRateLimited(req), false, 'only the first 5 requests were counted');
  });

  test('each client IP has its own limit', () => {
    const busy = newClient();
    sendRequests(isProxyRateLimited, busy, 5);
    assert.equal(isProxyRateLimited(busy), true);
    assert.equal(isProxyRateLimited(newClient()), false);
  });

  test('allows 10 new maps a minute, then limits', () => {
    const req = newClient();
    assert.ok(sendRequests(isCreateRateLimited, req, 10).every(limited => !limited));
    assert.equal(isCreateRateLimited(req), true);
    mock.timers.tick(60_000);
    assert.equal(isCreateRateLimited(req), false, 'a minute later it can create again');
  });

  test('allows 500 new maps a day, even when spread out', () => {
    const req = newClient();
    for (let i = 0; i < 500; i++) {
      assert.equal(isCreateRateLimited(req), false, `map ${i + 1}`);
      mock.timers.tick(60_000);
    }
    assert.equal(isCreateRateLimited(req), true, 'the 501st map that day is refused');
    mock.timers.tick(24 * 60 * 60_000);
    assert.equal(isCreateRateLimited(req), false, 'the next day it can create again');
  });

  test('a refused request does not use up the other limit', () => {
    const req = newClient();
    for (let i = 0; i < 50; i++) {
      sendRequests(isCreateRateLimited, req, 10);
      mock.timers.tick(60_000);
    }
    // 500 counted against the day; more attempts are refused without being counted against the minute
    sendRequests(isCreateRateLimited, req, 20);
    mock.timers.tick(24 * 60 * 60_000);
    assert.ok(sendRequests(isCreateRateLimited, req, 10).every(limited => !limited));
  });

  test('the API and proxy limits are counted separately', () => {
    const req = newClient();
    sendRequests(isProxyRateLimited, req, 5);
    assert.equal(isProxyRateLimited(req), true);
    assert.equal(isRateLimited(req), false);
  });
});
