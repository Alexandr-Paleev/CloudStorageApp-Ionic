import { defineConfig } from 'vitest/config';

/**
 * Two suites, two runtimes.
 *
 * `server` runs the Vercel handlers and the shared helpers under node.
 * `client` renders the React layer under jsdom.
 *
 * They were one node project until now, and coverage was scoped to api/ and
 * lib/ with a note saying Playwright covered the pages instead. It did not:
 * the e2e suite reached login, routing and the legal pages and stopped there,
 * so the React layer was covered by nothing — and the config said so out loud.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['api/**/*.test.ts', 'lib/**/*.test.ts'],
          /* e2e/ belongs to Playwright — vitest must not pick those specs up */
          exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
        },
      },
      {
        /**
         * Resolve like a browser, not like a server.
         *
         * Ionic 9 builds its React components on `@lit/react`, which ships two
         * copies: a browser one that attaches properties and event listeners in
         * `useLayoutEffect`, and a node one for server rendering that attaches
         * nothing. Vitest runs in node even with a jsdom environment, so it
         * picked the second — and every Ionic control rendered as markup that
         * answered no events. Four tests that fire `ionInput` at a searchbar
         * failed, while the same interaction passed in the e2e suite, which
         * drives a real browser.
         */
        resolve: {
          conditions: ['browser'],
        },
        /* Vitest transforms modules through Vite's SSR pipeline, which resolves
           by its own condition list — setting it on `resolve` alone leaves the
           node build in place. */
        ssr: {
          resolve: {
            conditions: ['browser'],
          },
        },
        test: {
          name: 'client',
          environment: 'jsdom',
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
          exclude: ['node_modules/**', 'dist/**'],
          setupFiles: ['./src/test/setup.ts'],
          /* src/env.ts validates import.meta.env with Zod at import time and
             the Supabase client is built from the result, so every module that
             transitively imports either one needs these two present.

             The Cloudinary cloud name is here for a different reason: the
             service reads it at module load to answer isConfigured(). Left to
             the developer's own .env, the suite passes on a machine that has
             one and fails in CI, which is exactly what happened. */
          env: {
            VITE_SUPABASE_URL: 'https://project.supabase.co',
            VITE_SUPABASE_ANON_KEY: 'test-anon-key',
            VITE_CLOUDINARY_CLOUD_NAME: 'test-cloud',
          },
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      include: ['api/**/*.ts', 'lib/**/*.ts', 'src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.d.ts',
        'lib/test-utils.ts',
        'src/test/**',
        /* iCloud leaves "name 2.ts" copies in the working tree. They are
           gitignored and absent from CI, so counting them here would make the
           local report disagree with the one on the run page. */
        '**/* 2.*',
        /* Entry points and type-only modules: running them proves nothing. */
        'src/main.tsx',
        'src/types/**',
      ],
    },
  },
});
