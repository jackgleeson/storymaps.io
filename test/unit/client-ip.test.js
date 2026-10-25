import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { pickClientIp } from '../server/rate-limit.js';

describe('pickClientIp', () => {
  test('uses socket.remoteAddress when trustProxy is false', () => {
    const req = { socket: { remoteAddress: '10.0.0.5' }, headers: { 'x-forwarded-for': '1.2.3.4' } };
    assert.equal(pickClientIp(req, { trustProxy: false }), '10.0.0.5');
  });

  test('uses last X-Forwarded-For entry when trustProxy is true', () => {
    const req = { socket: { remoteAddress: '10.0.0.5' }, headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } };
    assert.equal(pickClientIp(req, { trustProxy: true }), '5.6.7.8');
  });

  test('falls back to socket when trustProxy is true but no XFF header', () => {
    const req = { socket: { remoteAddress: '10.0.0.5' }, headers: {} };
    assert.equal(pickClientIp(req, { trustProxy: true }), '10.0.0.5');
  });
});
