import { defineConfig, devices } from '@playwright/test';

const PORT = 8100;
const baseURL = `http://localhost:${PORT}`;

/**
 * A second dev server, for the one spec that needs R2 to exist.
 *
 * VITE_R2_BUCKET_NAME is what ProviderManager reads to decide whether R2 is
 * available, and it is baked into the client at load time — there is no way to
 * turn it on for a single test. Setting it on the main server would divert
 * every other spec's uploads to R2 as well, and those specs are there to
 * exercise Supabase Storage. So: one server without it, one with, and a project
 * pointed at each.
 */
const R2_PORT = 8101;
const r2BaseURL = `http://localhost:${R2_PORT}`;

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
      testIgnore: /(resumable-upload|mobile)\.spec\.ts/,
    },
    {
      /* The size the README makes promises about. A whole second pass of the
         suite at phone width would double the run for assertions the desktop
         project already makes; this project carries the spec whose subject is
         the phone itself — layout, touch, and the accessibility of a menu that
         collapses at this width. */
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: /mobile\.spec\.ts/,
    },
    {
      /* Same browser, different origin: the one where R2 is configured. */
      name: 'chromium-r2',
      use: { ...devices['Desktop Chrome'], baseURL: r2BaseURL },
      testMatch: /resumable-upload\.spec\.ts/,
    },
  ],

  /* Requires a working .env — src/env.ts validates it on startup */
  webServer: [
    {
      command: 'npm run dev',
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `npm run dev -- --port ${R2_PORT}`,
      url: r2BaseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      /* The only difference from the server above, and the reason there are
         two. No R2 credentials are set: the spec that runs here answers every
         /api/r2/* call itself. */
      env: { ...process.env, VITE_R2_BUCKET_NAME: 'e2e-r2-bucket' } as Record<string, string>,
    },
  ],
});
