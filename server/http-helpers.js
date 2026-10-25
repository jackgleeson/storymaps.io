// SSRF protection: only allow HTTPS to public hosts
// Set DISABLE_SSRF_CHECK=1 in .env for local development
const DISABLE_SSRF_CHECK = process.env.DISABLE_SSRF_CHECK === '1';

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
    // Block IPv6 unspecified, loopback, unique local (fc00::/7), link-local (fe80::/10) and IPv4-mapped addresses
    if (host.includes(':') && /^(::1?|f[cd][0-9a-f]{2}:.*|fe[89ab][0-9a-f]:.*|.*::ffff:.*)$/.test(host)) return null;
    // Block this-network, private, carrier-grade NAT, loopback, link-local, multicast and reserved IPv4 ranges
    const parts = host.split('.').map(Number);
    if (parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) {
      const [a, b] = parts;
      if (a === 0 || a === 10 || a === 127 || a >= 224) return null;
      if (a === 100 && b >= 64 && b <= 127) return null;
      if (a === 169 && b === 254) return null;
      if (a === 172 && b >= 16 && b <= 31) return null;
      if (a === 192 && b === 168) return null;
    }
    return url.origin;
  } catch {
    return null;
  }
};

export const sendSSE = (res, event, data) => {
  if (!res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

export const fetchWithTimeout = (url, opts, ms = 30_000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timeout));
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

export const curlPost = async (url, params, timeoutMs = 30_000) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    const args = [
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
    if (status >= 400) throw new Error(`HTTP ${status} from ${new URL(url).hostname}`);
    try { return JSON.parse(body); }
    catch { throw new Error(`Expected JSON from ${url} but got non-JSON response`); }
  }
};

export const sanitizeFilename = (name) =>
  (name || '').toLowerCase().replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^[.-]+|-+$/g, '').substring(0, 200) || 'story-map';
