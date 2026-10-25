import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';

// The SSRF check is read from the environment on import, so make sure a dev shell can't turn it off
delete process.env.DISABLE_SSRF_CHECK;
const { validateExternalUrl, sanitizeFilename, safeJson } = await import('../server/http-helpers.js');

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
