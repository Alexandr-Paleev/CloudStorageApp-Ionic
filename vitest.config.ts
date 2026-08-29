import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'lib/**/*.test.ts', 'api/**/*.test.ts'],
    /* e2e/ belongs to Playwright — vitest must not pick those specs up */
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      /* Only what unit tests can meaningfully cover: the serverless handlers
         and the shared server-side helpers. React pages are exercised through
         Playwright instead, and counting them here would report a number that
         says nothing about either suite. */
      include: ['api/**/*.ts', 'lib/**/*.ts'],
      exclude: ['**/*.test.ts', 'lib/test-utils.ts'],
    },
  },
});
