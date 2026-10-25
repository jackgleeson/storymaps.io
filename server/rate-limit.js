// Pick the client IP. When trustProxy is true, honour the last entry
// of X-Forwarded-For (set by the closest trusted proxy, e.g. Caddy).
// Otherwise return the direct socket address — safe default when the
// app is not behind a reverse proxy or the proxy is untrusted.
export const pickClientIp = (req, { trustProxy } = {}) => {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return forwarded.split(',').pop().trim();
  }
  return req.socket.remoteAddress;
};

const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
const getClientIp = (req) => pickClientIp(req, { trustProxy: TRUST_PROXY });

// A limiter allows `limit` requests per `windowMs` from each client IP
const limiters = [];
const createLimiter = (limit, windowMs) => {
  const hits = new Map(); // ip -> request timestamps, oldest first
  const limiter = {
    hits,
    windowMs,
    // True when this IP has used up its allowance, without counting this request
    full: (ip, now) => {
      const timestamps = hits.get(ip);
      if (!timestamps) return false;
      while (timestamps.length && timestamps[0] <= now - windowMs) timestamps.shift();
      return timestamps.length >= limit;
    },
    record: (ip, now) => {
      if (!hits.has(ip)) hits.set(ip, []);
      hits.get(ip).push(now);
    },
  };
  limiters.push(limiter);
  return limiter;
};

// True when any of the limiters is full. Otherwise counts the request against all of them,
// so a refused request never uses up allowance.
const checkLimits = (req, ...checked) => {
  const ip = getClientIp(req);
  const now = Date.now();
  if (checked.some(l => l.full(ip, now))) return true;
  checked.forEach(l => l.record(ip, now));
  return false;
};

const api = createLimiter(30, 60_000);
const proxy = createLimiter(5, 60_000);
// Creating maps through the API: people and the CLI make one at a time, so this only stops
// scripts. The daily cap is generous because an office or school can share one address.
const createPerMinute = createLimiter(10, 60_000);
const createPerDay = createLimiter(500, 24 * 60 * 60_000);

export const isRateLimited = (req) => checkLimits(req, api);
export const isProxyRateLimited = (req) => checkLimits(req, proxy);
export const isCreateRateLimited = (req) => checkLimits(req, createPerMinute, createPerDay);

// Clean up stale entries every 5 minutes. unref() so this timer does
// not keep the process alive on its own (matters under node --test and
// for short-lived invocations).
setInterval(() => {
  const now = Date.now();
  for (const { hits, windowMs } of limiters) {
    for (const [ip, timestamps] of hits) {
      while (timestamps.length && timestamps[0] <= now - windowMs) timestamps.shift();
      if (!timestamps.length) hits.delete(ip);
    }
  }
}, 5 * 60_000).unref();
