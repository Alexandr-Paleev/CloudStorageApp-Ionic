import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'api/**/*.test.ts'],
    /* e2e/ belongs to Playwright — vitest must not pick those specs up */
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
