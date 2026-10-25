import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createRouter } from '../../server/router.js';

describe('createRouter', () => {
  const setup = () => {
    const router = createRouter();
    const handlers = { list: () => {}, get: () => {}, put: () => {}, unlock: () => {} };
    router.route('POST', '/api/maps', handlers.list);
    router.route('GET', '/api/maps/:id', handlers.get);
    router.route('PUT', '/api/maps/:id', handlers.put);
    router.route('POST', '/api/lock/:mapId/unlock', handlers.unlock);
    return { ...router, handlers };
  };

  test('matches a static path exactly', () => {
    const { matchRoute, handlers } = setup();
    assert.deepEqual(matchRoute('POST', '/api/maps'), { handler: handlers.list, params: {} });
    assert.equal(matchRoute('POST', '/api/maps/'), null);
  });

  test('pulls named values out of the path', () => {
    const { matchRoute, handlers } = setup();
    const match = matchRoute('POST', '/api/lock/abc12345/unlock');
    assert.equal(match.handler, handlers.unlock);
    assert.deepEqual({ ...match.params }, { mapId: 'abc12345' });
  });

  test('picks the handler for the request method', () => {
    const { matchRoute, handlers } = setup();
    assert.equal(matchRoute('GET', '/api/maps/abc12345').handler, handlers.get);
    assert.equal(matchRoute('PUT', '/api/maps/abc12345').handler, handlers.put);
    assert.equal(matchRoute('DELETE', '/api/maps/abc12345'), null);
  });

  test('a value cannot contain a slash or a dot', () => {
    const { matchRoute } = setup();
    assert.equal(matchRoute('GET', '/api/maps/abc/def'), null);
    assert.equal(matchRoute('GET', '/api/maps/..'), null);
    assert.equal(matchRoute('GET', '/api/maps/abc.json'), null);
  });

  test('the whole path has to match', () => {
    const { matchRoute } = setup();
    assert.equal(matchRoute('GET', '/api/maps/abc12345/extra'), null);
    assert.equal(matchRoute('GET', '/prefix/api/maps/abc12345'), null);
  });

  test('the first route registered wins', () => {
    const router = createRouter();
    const first = () => {};
    router.route('GET', '/api/maps/:id', first);
    router.route('GET', '/api/maps/:other', () => {});
    assert.equal(router.matchRoute('GET', '/api/maps/abc12345').handler, first);
  });

  test('returns null when nothing matches', () => {
    assert.equal(createRouter().matchRoute('GET', '/'), null);
  });
});
