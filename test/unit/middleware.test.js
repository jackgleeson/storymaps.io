import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';

// Allowed origins are read from the environment on import, so test against the defaults
delete process.env.STORYMAPS_ALLOWED_ORIGINS;
const { isOriginAllowed, isCliApi, parseBody } = await import('../../server/middleware.js');

describe('isOriginAllowed', () => {
  test('allows the storymaps.io origins', () => {
    assert.ok(isOriginAllowed('https://storymaps.io'));
    assert.ok(isOriginAllowed('https://www.storymaps.io'));
  });

  test('allows localhost and 127.0.0.1 on any port', () => {
    assert.ok(isOriginAllowed('http://localhost:3000'));
    assert.ok(isOriginAllowed('http://127.0.0.1:8080'));
  });

  test('rejects other origins', () => {
    assert.ok(!isOriginAllowed('https://evil.example'));
    assert.ok(!isOriginAllowed('http://storymaps.io'), 'http is not the same origin');
  });

  test('rejects lookalike hostnames', () => {
    assert.ok(!isOriginAllowed('https://storymaps.io.evil.example'));
    assert.ok(!isOriginAllowed('https://localhost.evil.example'));
  });

  test('rejects a missing, null or invalid origin', () => {
    assert.ok(!isOriginAllowed(undefined));
    assert.ok(!isOriginAllowed(''));
    assert.ok(!isOriginAllowed('null'));
  });
});

describe('isCliApi', () => {
  test('matches the CLI write routes', () => {
    assert.ok(isCliApi('/api/maps', 'POST'));
    assert.ok(isCliApi('/api/maps/abc12345', 'PUT'));
    assert.ok(isCliApi('/api/maps/abc12345', 'DELETE'));
    assert.ok(isCliApi('/api/lock/abc12345', 'POST'));
    assert.ok(isCliApi('/api/lock/abc12345/unlock', 'POST'));
    assert.ok(isCliApi('/api/lock/abc12345/remove', 'POST'));
  });

  test('does not match reads', () => {
    assert.ok(!isCliApi('/api/maps/abc12345', 'GET'));
  });

  test('does not match other write routes', () => {
    assert.ok(!isCliApi('/api/backups/abc12345', 'POST'));
    assert.ok(!isCliApi('/api/maps/abc12345/log', 'POST'));
    assert.ok(!isCliApi('/api/lock/abc12345/other', 'POST'));
    assert.ok(!isCliApi('/api/import/jira', 'POST'));
  });

  test('does not match look-alike paths', () => {
    assert.ok(!isCliApi('/api/maps/', 'POST'));
    assert.ok(!isCliApi('/api/maps/ABC12345', 'PUT'));
    assert.ok(!isCliApi('/api/maps/abc12345/', 'PUT'));
  });
});

describe('parseBody', () => {
  // A request that sends its body once parseBody has attached its listeners
  const request = (body, contentType = 'application/json') => {
    const req = new EventEmitter();
    req.headers = { 'content-type': contentType };
    req.destroyed = false;
    req.destroy = () => { req.destroyed = true; };
    setImmediate(() => {
      for (const chunk of [].concat(body)) req.emit('data', Buffer.from(chunk));
      req.emit('end');
    });
    return req;
  };

  test('an empty or blank body is an empty object', async () => {
    assert.deepEqual(await parseBody(request('')), {});
    assert.deepEqual(await parseBody(request('  \n')), {});
  });

  test('parses JSON sent in several chunks', async () => {
    assert.deepEqual(await parseBody(request(['{"name":', '"Map"}'])), { name: 'Map' });
  });

  test('invalid JSON resolves to an error marked as a parse error', async () => {
    const out = await parseBody(request('{nope'));
    assert.ok(out instanceof Error);
    assert.equal(out.parseError, true);
  });

  test('parses a YAML body into map JSON', async () => {
    const yaml = 'name: Test\nsteps:\n  - Sign up\nslices:\n  - name: MVP\n    stories:\n      Sign up:\n        - name: Email form\n';
    const out = await parseBody(request(yaml, 'text/yaml'));
    assert.equal(out.name, 'Test');
    assert.equal(out.steps[0].name, 'Sign up');
    assert.equal(out.slices[0].stories[0][0].name, 'Email form');
  });

  test('YAML that fails validation resolves to an error with the validation errors', async () => {
    const out = await parseBody(request('name: Test\nsteps: []\n', 'application/x-yaml'));
    assert.ok(out instanceof Error);
    assert.ok(out.validationErrors.length > 0);
  });

  test('a body over 5 MB is cut off and resolves to null', async () => {
    const req = request('x'.repeat(5_242_881));
    assert.equal(await parseBody(req), null);
    assert.ok(req.destroyed);
  });

  test('a request error resolves to null', async () => {
    const req = new EventEmitter();
    req.headers = {};
    setImmediate(() => req.emit('error', new Error('socket hang up')));
    assert.equal(await parseBody(req), null);
  });
});
