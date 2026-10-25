import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';

// Runs the real server.js on a spare port with the given data folder, so it doesn't touch
// ./data or a dev server that's already running.
export const ROOT = new URL('../../', import.meta.url).pathname;

const freePort = () => new Promise((resolve) => {
  const probe = createServer().listen(0, () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

export const testEnv = (dataDir, extra = {}) => {
  const env = { ...process.env };
  for (const key of ['NODE_TEST_CONTEXT', 'STORYMAPS_ALLOWED_ORIGINS', 'DISABLE_SSRF_CHECK', 'IMPORT_EXPORT_ENABLED']) delete env[key];
  return { ...env, DATA_DIR: dataDir, ...extra };
};

export const startServer = async (dataDir, extraEnv = {}) => {
  const port = await freePort();
  // Trust X-Forwarded-For, as production does behind Caddy, so tests can create maps from
  // different addresses without reaching the per-address limits
  const env = testEnv(dataDir, { PORT: String(port), TRUST_PROXY: 'true', ...extraEnv });
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 15_000);
    server.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('Server running')) { clearTimeout(timer); resolve(); }
    });
    server.stderr.on('data', (chunk) => { output += chunk; });
    server.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${output}`)); });
  });
  return {
    base: `http://localhost:${port}`,
    wsBase: `ws://localhost:${port}`,
    // Stops the server the way Docker does, so it writes everything to disk first
    stop: async () => {
      if (server.exitCode !== null) return;
      server.kill('SIGTERM');
      await once(server, 'exit');
    },
  };
};
