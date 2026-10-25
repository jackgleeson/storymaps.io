import { defineConfig, devices } from '@playwright/test';

// Browser tests for the main user journeys. `npm run test:e2e` starts its own server on a spare
// port with a temporary data folder, so it can run alongside a dev server.
const PORT = Number(process.env.E2E_PORT) || 3210;

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /\.phone\.spec\.js$/,
      // Locally, use the installed Chrome rather than downloading a browser
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, channel: process.env.CI ? undefined : 'chrome' },
    },
    {
      name: 'phone',
      testMatch: /\.phone\.spec\.js$/,
      use: { ...devices['iPhone 13'] },
    },
  ],
  webServer: {
    command: 'node test/e2e/start-server.js',
    url: `http://localhost:${PORT}`,
    // Trust X-Forwarded-For, as production does behind Caddy, so each test can have its own
    // client address and the per-address rate limits don't add up across the suite
    env: { PORT: String(PORT), TRUST_PROXY: 'true' },
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
