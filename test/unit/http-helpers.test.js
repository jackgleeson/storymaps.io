import { describe, test, afterEach, mock } from 'node:test';
import { strict as assert } from 'node:assert';
import https from 'node:https';
import dns from 'node:dns';

// The SSRF check is read from the environment on import, so make sure a dev shell can't turn it off
delete process.env.DISABLE_SSRF_CHECK;
const { validateExternalUrl, sanitizeFilename, safeJson, isPrivateAddress, publicLookup, fetchWithTimeout } = await import('../../server/http-helpers.js');
const { fakeHttps } = await import('./fake-https.js');

// Make every host name look up to these addresses
const resolvesTo = (...addresses) => mock.method(dns, 'lookup', (host, options, callback) =>
  callback(null, addresses.map(address => ({ address, family: address.includes(':') ? 6 : 4 }))));

describe('validateExternalUrl', () => {
  test('returns the origin of a public https URL', () => {
    assert.equal(validateExternalUrl('https://example.atlassian.net/browse/ABC-1?x=1'), 'https://example.atlassian.net');
  });

  test('adds https:// when the scheme is missing', () => {
    assert.equal(validateExternalUrl('example.atlassian.net'), 'https://example.atlassian.net');
  });

  test('keeps a port and ignores the case of the scheme', () => {
    assert.equal(validateExternalUrl('jira.example.com:8443'), 'https://jira.example.com:8443');
    assert.equal(validateExternalUrl('HTTPS://Jira.Example.com'), 'https://jira.example.com');
  });

  test('allows public IP addresses', () => {
    assert.equal(validateExternalUrl('https://8.8.8.8'), 'https://8.8.8.8');
    assert.equal(validateExternalUrl('https://[2606:4700::1111]'), 'https://[2606:4700::1111]');
  });

  test('allows addresses just outside the 172.16.0.0/12 private range', () => {
    assert.equal(validateExternalUrl('https://172.15.0.1'), 'https://172.15.0.1');
    assert.equal(validateExternalUrl('https://172.32.0.1'), 'https://172.32.0.1');
  });

  test('rejects empty input and URLs that do not parse', () => {
    assert.equal(validateExternalUrl(''), null);
    assert.equal(validateExternalUrl(null), null);
    assert.equal(validateExternalUrl('https://exa mple.com'), null);
  });

  test('rejects anything other than https', () => {
    assert.equal(validateExternalUrl('http://example.com'), null);
    assert.equal(validateExternalUrl('ftp://example.com'), null);
  });

  const blocked = {
    'localhost': 'https://localhost',
    'localhost in capitals': 'https://LOCALHOST',
    '127.0.0.1': 'https://127.0.0.1:8080',
    '127.0.0.1 written as a decimal number': 'https://2130706433',
    '127.0.0.1 written in hex': 'https://0x7f.1',
    'IPv4-mapped IPv6 loopback': 'https://[::ffff:127.0.0.1]',
    '10.0.0.0/8': 'https://10.1.2.3',
    '172.16.0.0/12 (start)': 'https://172.16.0.1',
    '172.16.0.0/12 (end)': 'https://172.31.255.255',
    '192.168.0.0/16': 'https://192.168.1.1',
    'the cloud metadata address': 'https://169.254.169.254',
    'the GCE metadata hostname': 'https://metadata.google.internal',
    '.local hostnames': 'https://printer.local',
    'nip.io': 'https://10.0.0.1.nip.io',
    'sslip.io': 'https://anything.sslip.io',
    'xip.io': 'https://anything.xip.io',
    'nip.io with a trailing dot': 'https://10.0.0.1.nip.io.',
    '.localhost subdomains': 'https://app.localhost',
    'IPv6 loopback': 'https://[::1]',
    'the IPv6 unspecified address': 'https://[::]',
    'the rest of 127.0.0.0/8': 'https://127.0.0.2',
    '0.0.0.0': 'https://0.0.0.0',
    'carrier-grade NAT (100.64.0.0/10)': 'https://100.64.0.1',
    'multicast addresses': 'https://224.0.0.1',
    'the broadcast address': 'https://255.255.255.255',
    'IPv6 unique local addresses (fc00::/7)': 'https://[fd00::1]',
    'IPv6 link-local addresses (fe80::/10)': 'https://[fe80::1]',
    'localhost with a trailing dot': 'https://localhost.',
    'the benchmarking range (198.18.0.0/15)': 'https://198.18.0.1',
    'IPv4 addresses reached through NAT64': 'https://[64:ff9b::a00:1]',
  };
  for (const [label, url] of Object.entries(blocked)) {
    test(`rejects ${label}`, () => {
      assert.equal(validateExternalUrl(url), null, url);
    });
  }
});

describe('sanitizeFilename', () => {
  test('lowercases and turns spaces into hyphens', () => {
    assert.equal(sanitizeFilename('My Story  Map'), 'my-story-map');
  });

  test('replaces path separators and reserved characters', () => {
    assert.equal(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j'), 'a-b-c-d-e-f-g-h-i-j');
  });

  test('strips leading dots', () => {
    assert.equal(sanitizeFilename('.hidden'), 'hidden');
  });

  test('a path cannot climb directories or leave a leading dot', () => {
    const out = sanitizeFilename('../../etc/passwd');
    assert.ok(!out.includes('/'), out);
    assert.ok(!out.startsWith('.'), out);
  });

  test('strips control characters', () => {
    assert.equal(sanitizeFilename('bad\x00name\nhere'), 'bad-name-here');
  });

  test('cuts long names to 200 characters', () => {
    assert.equal(sanitizeFilename('a'.repeat(300)).length, 200);
  });

  test('falls back to story-map when nothing is left', () => {
    assert.equal(sanitizeFilename(''), 'story-map');
    assert.equal(sanitizeFilename(null), 'story-map');
    assert.equal(sanitizeFilename('...'), 'story-map');
  });
});

describe('safeJson', () => {
  const response = (status, text) => ({ status, text: async () => text });

  test('parses a JSON body', async () => {
    assert.deepEqual(await safeJson(response(200, '{"ok":true}')), { ok: true });
  });

  test('throws with the status and the start of the body when it is not JSON', async () => {
    await assert.rejects(safeJson(response(502, '<html>Bad gateway</html>')), /HTTP 502 - expected JSON but got: <html>Bad gateway/);
  });

  test('keeps the error message short for a large body', async () => {
    await assert.rejects(safeJson(response(500, 'x'.repeat(5000))), (err) => err.message.length < 300);
  });
});

describe('isPrivateAddress', () => {
  test('public addresses are allowed', () => {
    for (const address of ['8.8.8.8', '93.184.215.14', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8']) {
      assert.equal(isPrivateAddress(address), false, address);
    }
  });

  test('private, local and reserved addresses are not', () => {
    for (const address of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.0.1', '100.64.0.1',
      '0.0.0.0', '224.0.0.1', '::', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:169.254.169.254', 'not an address']) {
      assert.equal(isPrivateAddress(address), true, address);
    }
  });
});

describe('publicLookup', () => {
  afterEach(() => mock.restoreAll());
  const lookup = (host, options) => new Promise((resolve, reject) =>
    publicLookup(host, options, (err, ...result) => (err ? reject(err) : resolve(result))));

  test('gives the address of a public host name', async () => {
    resolvesTo('93.184.215.14');
    assert.deepEqual(await lookup('example.com', {}), ['93.184.215.14', 4]);
    assert.deepEqual(await lookup('example.com', { all: true }), [[{ address: '93.184.215.14', family: 4 }]]);
  });

  test('refuses a host name with any private address', async () => {
    resolvesTo('93.184.215.14', '10.0.0.1');
    await assert.rejects(lookup('mixed.example', {}), { code: 'EPRIVATEADDRESS' });
    resolvesTo('fd00::1');
    await assert.rejects(lookup('ula.example', {}), /ula.example resolves to a private address/);
  });

  test('passes lookup errors through', async () => {
    mock.method(dns, 'lookup', (host, options, callback) => callback(Object.assign(new Error('not found'), { code: 'ENOTFOUND' })));
    await assert.rejects(lookup('missing.example', {}), { code: 'ENOTFOUND' });
  });
});

describe('fetchWithTimeout', () => {
  afterEach(() => mock.restoreAll());

  test('returns the status and body of the response', async () => {
    fakeHttps(() => [201, { ok: true }]);
    const r = await fetchWithTimeout('https://example.com/api', { method: 'POST', body: '{}' });
    assert.equal(r.status, 201);
    assert.deepEqual(await r.json(), { ok: true });
  });

  test('a host name that resolves to a private address is refused when connecting', async () => {
    // The real https.request, which looks up the host with publicLookup
    resolvesTo('169.254.169.254');
    await assert.rejects(fetchWithTimeout('https://rebind.example/latest/meta-data'), /resolves to a private address/);
  });

  test('a private address in the URL is refused without a request', async () => {
    mock.method(https, 'request', () => assert.fail('no request should be made'));
    await assert.rejects(fetchWithTimeout('https://[fd00::1]/'), /private address/);
    await assert.rejects(fetchWithTimeout('https://10.0.0.1/'), /private address/);
  });

  test('only https is allowed', async () => {
    mock.method(https, 'request', () => assert.fail('no request should be made'));
    await assert.rejects(fetchWithTimeout('http://example.com/'), /Only https/);
  });

  test('redirects are followed, with each address checked', async () => {
    const requests = [];
    fakeHttps((request) => {
      requests.push(request.url);
      return request.url.includes('/old') ? [301, '', { location: '/new' }] : [200, { ok: true }];
    });
    const r = await fetchWithTimeout('https://jira.example.com/old');
    assert.deepEqual(await r.json(), { ok: true });
    assert.deepEqual(requests, ['https://jira.example.com/old', 'https://jira.example.com/new']);
  });

  test('a redirect to a private address is refused', async () => {
    fakeHttps(() => [302, '', { location: 'https://169.254.169.254/latest/meta-data' }]);
    await assert.rejects(fetchWithTimeout('https://evil.example/'), /169.254.169.254 is a private address/);
    fakeHttps(() => [302, '', { location: 'http://example.com/' }]);
    await assert.rejects(fetchWithTimeout('https://evil.example/'), /Only https/);
  });

  test('credentials are only sent to the site they were given for', async () => {
    const requests = [];
    fakeHttps((request) => {
      requests.push(request);
      if (request.url === 'https://a.example/1') return [302, '', { location: '/2' }];
      if (request.url === 'https://a.example/2') return [307, '', { location: 'https://b.example/3' }];
      return [200, {}];
    });
    await fetchWithTimeout('https://a.example/1', { headers: { Authorization: 'Basic secret', Accept: 'application/json' } });
    assert.deepEqual(requests.map(r => r.headers), [
      { Authorization: 'Basic secret', Accept: 'application/json' },
      { Authorization: 'Basic secret', Accept: 'application/json' },
      { Accept: 'application/json' },
    ]);
  });

  test('a POST redirected with a 303 becomes a GET with no body', async () => {
    const requests = [];
    fakeHttps((request) => {
      requests.push([request.method, request.body]);
      return requests.length === 1 ? [303, '', { location: '/done' }] : [200, {}];
    });
    await fetchWithTimeout('https://a.example/', { method: 'POST', body: '{"x":1}' });
    assert.deepEqual(requests, [['POST', '{"x":1}'], ['GET', undefined]]);
  });

  test('gives up after 5 redirects', async () => {
    let count = 0;
    fakeHttps(() => { count++; return [302, '', { location: '/again' }]; });
    await assert.rejects(fetchWithTimeout('https://loop.example/'), /Too many redirects from loop.example/);
    assert.equal(count, 6);
  });
});
