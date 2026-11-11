// Shared client module: pure YAML transform used by server for body parsing.
// See note in server.js for rationale on sharing client transfer code.
import { importFromYaml } from '../src/transfer/yaml.js';

export const parseOrigins = (s) =>
  new Set((s || '').split(',').map(x => x.trim()).filter(Boolean));

// Allowed origins for API writes and WebSocket connections.
// STORYMAPS_ALLOWED_ORIGINS (comma-separated) overrides these defaults.
// localhost / 127.0.0.1 are always allowed for development (see isOriginAllowed).
const DEFAULT_ORIGINS = [
  'https://storymaps.io',
  'https://www.storymaps.io',
  'https://new.storymaps.io',
];

export const buildAllowedOrigins = (envValue) => {
  const env = parseOrigins(envValue);
  return env.size > 0 ? env : new Set(DEFAULT_ORIGINS);
};

const ALLOWED_ORIGINS = buildAllowedOrigins(process.env.STORYMAPS_ALLOWED_ORIGINS);

export const isOriginAllowed = (origin) => {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
};

// CLI API routes skip origin checks (rate-limited instead). The CLI can make a backup,
// but not import or delete one. For projects, it can start one, add maps, check the password,
// and lock or remove the lock; renaming, reordering, removing maps and deleting stay in the app.
export const isCliApi = (path, method) =>
  (/^\/api\/(maps(\/[a-z0-9]+)?|lock\/[a-z0-9]+(\/(?:unlock|remove))?)$/.test(path) && ['POST', 'PUT', 'DELETE'].includes(method))
  || (/^\/api\/backups\/[a-z0-9]+$/.test(path) && method === 'POST')
  || (/^\/api\/projects(\/[a-zA-Z0-9_-]+\/(maps|unlock|lock|lock\/remove))?$/.test(path) && method === 'POST');

// Parse body for POST/PUT/DELETE (5 MB limit, YAML-aware)
export const parseBody = (req) => {
  const MAX_BODY = 5_242_880;
  const contentType = (req.headers['content-type'] || '').toLowerCase();
  const isYaml = contentType.includes('text/yaml') || contentType.includes('application/x-yaml');
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { req.destroy(); reject(new Error('Body too large')); return; }
      data += chunk;
    });
    req.on('end', () => {
      if (!data.trim()) { resolve({}); return; }
      try {
        if (isYaml) {
          resolve(importFromYaml(data));
        } else {
          resolve(JSON.parse(data));
        }
      } catch (e) {
        if (isYaml && e.validationErrors) {
          const err = new Error('YAML validation failed');
          err.validationErrors = e.validationErrors;
          err.validationWarnings = e.validationWarnings;
          reject(err);
        } else {
          const err = new Error('Invalid JSON');
          err.parseError = true;
          reject(err);
        }
      }
    });
    req.on('error', reject);
  }).catch((e) => {
    if (e.validationErrors || e.parseError) return e;
    return null;
  });
};
