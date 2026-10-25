import https from 'node:https';
import dns from 'node:dns';
import { BlockList, isIP } from 'node:net';

// SSRF protection: only allow HTTPS to public hosts
// Set DISABLE_SSRF_CHECK=1 in .env for local development
const DISABLE_SSRF_CHECK = process.env.DISABLE_SSRF_CHECK === '1';

// Addresses outside the public internet. The IPv4 rules also match IPv4 addresses written
// in IPv6 form (::ffff:10.0.0.1).
const privateAddresses = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3],
]) privateAddresses.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::', 127], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
]) privateAddresses.addSubnet(address, prefix, 'ipv6');

export const isPrivateAddress = (address) => {
  const family = isIP(address);
  return family === 0 || privateAddresses.check(address, family === 6 ? 'ipv6' : 'ipv4');
};

// A dns.lookup that refuses host names with a private address among their addresses. Requests
// connect to the address checked here, so a host name can't switch to a private address
// between the check and the connection.
export const publicLookup = (hostname, options, callback) => {
  if (typeof options === 'function') { callback = options; options = {}; }
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses.length || addresses.some(a => isPrivateAddress(a.address))) {
      const blocked = new Error(`${hostname} resolves to a private address`);
      blocked.code = 'EPRIVATEADDRESS';
      return callback(blocked);
    }
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
};

export const validateExternalUrl = (input) => {
  if (!input) return null;
  try {
    // Add https:// only when there's no scheme, so ftp://host is rejected rather than read as host "ftp"
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input);
    const url = new URL(hasScheme ? input : 'https://' + input);
    if (DISABLE_SSRF_CHECK) return ['http:', 'https:'].includes(url.protocol) ? url.origin : null;
    if (url.protocol !== 'https:') return null;
    // Compare without IPv6 brackets or a trailing dot ("localhost." is still localhost)
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
    if (host === 'localhost' || host.endsWith('.localhost')) return null;
    if (host.endsWith('.local') || host.endsWith('.internal')) return null;
    // Block DNS rebinding services that resolve to arbitrary IPs
    if (/\.(nip|sslip|xip)\.io$/.test(host)) return null;
    // Block private addresses written into the URL. Host names are checked when they're looked up.
    if (isIP(host) && isPrivateAddress(host)) return null;
    return url.origin;
  } catch {
    return null;
  }
};

export const sendSSE = (res, event, data) => {
  if (!res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

const MAX_RESPONSE = 50 * 1024 * 1024;
const MAX_REDIRECTS = 5;

// One https request with no redirects. The host must be a public address, or a host name
// that publicLookup accepts.
const requestOnce = (url, { method, headers, body }, ms) => {
  if (url.protocol !== 'https:') return Promise.reject(new Error('Only https URLs are allowed'));
  // An address in the URL isn't looked up, so check it here
  const literal = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(literal) && isPrivateAddress(literal)) return Promise.reject(new Error(`${literal} is a private address`));
  // Send the length of a body, since some servers refuse chunked bodies
  if (body !== undefined) headers = { ...headers, 'Content-Length': Buffer.byteLength(body) };
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers, lookup: publicLookup }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE) req.destroy(new Error('Response too large'));
        else chunks.push(chunk);
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.setTimeout(ms, () => req.destroy(new Error(`Request to ${url.hostname} timed out`)));
    req.on('error', reject);
    req.end(body);
  });
};

// Request a URL on an outside service and resolve with a fetch Response. Every address it
// connects to must be public, including the ones redirects lead to, and credentials aren't
// passed on when a redirect leads to another site.
export const fetchWithTimeout = async (url, opts = {}, ms = 30_000) => {
  if (DISABLE_SSRF_CHECK) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ms);
    return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timeout));
  }
  let current = new URL(url);
  let { method = 'GET', headers = {}, body } = opts;
  for (let redirects = 0; ; redirects++) {
    const res = await requestOnce(current, { method, headers, body }, ms);
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      if (redirects === MAX_REDIRECTS) throw new Error(`Too many redirects from ${new URL(url).hostname}`);
      const next = new URL(res.headers.location, current);
      if (next.origin !== current.origin) {
        headers = Object.fromEntries(Object.entries(headers).filter(([name]) => !['authorization', 'cookie'].includes(name.toLowerCase())));
      }
      // As browsers do, a 303, or a 301 or 302 after a POST, becomes a GET with no body
      if (res.status === 303 || ([301, 302].includes(res.status) && method === 'POST')) {
        method = 'GET';
        body = undefined;
      }
      current = next;
      continue;
    }
    const responseHeaders = Object.entries(res.headers).filter(([, v]) => typeof v === 'string');
    const responseBody = [204, 205, 304].includes(res.status) ? null : res.body;
    return new Response(responseBody, { status: res.status, headers: responseHeaders });
  }
};

export const safeJson = async (res) => {
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new Error(`HTTP ${res.status} - expected JSON but got: ${text.slice(0, 200)}`); }
};

// Some hosts (e.g. Wikimedia) block Node.js TLS fingerprints but allow curl.
// This posts form data via curl and returns parsed JSON.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Look up the host in a URL with publicLookup, and return curl options that make curl connect
// to the checked address. curl does its own lookup otherwise.
const curlPinnedAddress = async (url) => {
  if (DISABLE_SSRF_CHECK) return [];
  const { protocol, hostname, port } = new URL(url);
  if (protocol !== 'https:') throw new Error('Only https URLs are allowed');
  const host = hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error(`${host} is a private address`);
    return ['--proto', '=https'];
  }
  const { address, family } = await new Promise((resolve, reject) =>
    publicLookup(host, {}, (err, address, family) => (err ? reject(err) : resolve({ address, family }))));
  return ['--proto', '=https', '--resolve', `${host}:${port || 443}:${family === 6 ? `[${address}]` : address}`];
};

export const curlPost = async (url, params, timeoutMs = 30_000) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    const args = [
      ...await curlPinnedAddress(url),
      '-s', '-S',
      '-w', '\n%{http_code}',
      '--max-time', String(Math.ceil(timeoutMs / 1000)),
      '-X', 'POST',
      '-H', 'User-Agent: Storymaps.io/1.0 (https://storymaps.io; admin@storymaps.io)',
      '-H', 'Accept: application/json',
    ];
    if (params instanceof URLSearchParams) {
      args.push('-d', params.toString());
    }
    args.push(url);
    const { stdout } = await execFileAsync('curl', args, { maxBuffer: 2 * 1024 * 1024 });
    const lastNewline = stdout.lastIndexOf('\n');
    const body = stdout.slice(0, lastNewline);
    const status = parseInt(stdout.slice(lastNewline + 1), 10);
    if (status === 429) {
      if (attempt < 3) { await sleep(2000 * (attempt + 1)); continue; }
      throw new Error('Rate limited by server after multiple retries.');
    }
    if (status >= 300 && status < 400) throw new Error(`HTTP ${status} from ${new URL(url).hostname}. Redirects aren't followed, so use the address the service redirects to`);
    if (status >= 400) throw new Error(`HTTP ${status} from ${new URL(url).hostname}`);
    try { return JSON.parse(body); }
    catch { throw new Error(`Expected JSON from ${url} but got non-JSON response`); }
  }
};

export const sanitizeFilename = (name) =>
  (name || '').toLowerCase().replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^[.-]+|-+$/g, '').substring(0, 200) || 'story-map';
