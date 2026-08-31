import { defineConfig, devices } from '@playwright/test';

const PORT = 8100;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  /* One worker in CI used to be necessary: every signed-in spec shared a single
     throwaway account, so parallel tests would have seen each other's files.
     The fixture in e2e/fixtures.ts gives each test its own account, which makes
     the data disjoint by construction — four is the runner's core count on the
     hosted image. */
  workers: process.env.CI ? 4 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    /* vite-plugin-pwa registers a service worker in dev mode too — block it
       so tests always hit the dev server instead of a cached response */
    serviceWorkers: 'block',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Requires a working .env — src/env.ts validates it on startup */
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
