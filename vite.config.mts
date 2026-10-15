import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { devApi } from './vite-plugin-dev-api.mts';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    /* Serves api/ from the dev server; no-op during build */
    devApi(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192x192-v2.png', 'icon-512x512-v2.png'],
      manifest: {
        name: 'Cloud Storage App',
        short_name: 'Cloud Storage',
        description: 'Store and manage your files in the cloud',
        theme_color: '#3880ff',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/icon-192x192-v2.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/icon-512x512-v2.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        /* Of Inter's subsets only the Latin one is precached: every screen
           needs it. The others are for a file name that asks for them, and
           are fetched then, by the fonts cache below. */
        globIgnores: ['fonts/inter-v20-!(latin).woff2'],
        /**
         * Workbox answers every navigation inside the worker's scope with the
         * cached index.html, and nothing tells it where the app ends. A
         * browser sent past that edge was shown the app's "not found" page
         * instead of what the server would have said.
         *
         * Two kinds of address are not the app. /api/ is the functions, the
         * line vercel.json draws for its own rewrite. A path that ends in a
         * file extension is a file: Vercel serves a file that exists before
         * it consults the rewrite at all, and the worker precaches only some
         * of them — public/demo/welcome.pdf is one it does not. No route of
         * the app ends that way: the ids in them are UUIDs and base64url
         * tokens. Only the path is looked at, because a dot in a query string
         * says nothing about what the address is.
         *
         * Declining a navigation here hands it to the next route in line, so
         * the image cache below is written not to take one.
         *
         * `npm run dev` cannot show any of this. The worker the dev server
         * generates falls back for `/` alone, so
         * scripts/smoke-built-bundle.mjs asks the built one in a real
         * browser.
         */
        navigateFallbackDenylist: [/^\/api\//, /^[^?]*\.[a-z0-9]+(\?|$)/i],
        runtimeCaching: [
          {
            /* The font subsets the precache leaves out, once a page has asked
               for one. Their names carry Inter's version, so a kept file
               cannot go stale. */
            urlPattern: ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith('/fonts/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
            },
          },
          {
            /**
             * An image asked for as an image, never a navigation to one. The
             * router tries its routes in order, so a navigation the fallback
             * has declined arrives here next, and this cache would keep
             * whatever the server said for thirty days. For an address that
             * does not exist, that is the app shell.
             *
             * The rest is what /\.(?:png|…)$/ did as a plain RegExp: this
             * origin only, matched against the whole address. Workbox writes
             * the function into the worker as text, so it can use nothing but
             * its own arguments.
             */
            urlPattern: ({ request, sameOrigin, url }) =>
              sameOrigin &&
              request.mode !== 'navigate' &&
              /\.(?:png|jpg|jpeg|svg|gif|webp)$/.test(url.href),
            handler: 'CacheFirst',
            options: {
              cacheName: 'images-cache',
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
  resolve: {
    /* The names in tsconfig.base.json. The build finds them without being
       told; the dev server does not, and answers 500 for the first module
       that uses one. This makes the two agree. */
    tsconfigPaths: true,
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 8100,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      /**
       * Ionic's components, as modules with no side effects of their own.
       *
       * @ionic/core says nothing about side effects in its package.json, so the
       * bundler has to assume every module it imports has some, and keeps it.
       * @ionic/react imports all of Ionic's components to wrap them, and the
       * wrappers nothing uses are dropped: they are marked pure. The modules
       * behind them stayed. Of the 80 Ionic component modules in the bundle,
       * 37 were components this app never renders — datetime, range, menu,
       * accordion, input-otp and the rest — and the Ionic chunk was 245.7 kB
       * gzipped, of a first load of 438.2. Without them it is 177.2 of 369.6.
       *
       * Nothing that runs changed with them. A wrapper registers its element
       * when the wrapper is created, so every element the app can show is
       * registered the moment the Ionic chunk has run, and the built app
       * registered the same 52 elements before this rule as after it
       * (2026-10-15). The dropped modules defined classes that nothing
       * registered. A component the app does render is used by its wrapper,
       * and a module whose code is used stays, whatever this rule says.
       *
       * The rule covers the component modules and nothing else in Ionic. Its
       * shared modules, the stylesheets and initialize() keep the default.
       * scripts/smoke-built-bundle.mjs checks, in the built app, that every
       * Ionic component the source renders is registered: what this rule
       * asserts about a package that does not assert it about itself has to
       * be asked again after every upgrade of that package.
       */
      treeshake: {
        moduleSideEffects: [
          {
            test: /\/node_modules\/@ionic\/core\/components\/ion-[a-z0-9-]+\.js$/,
            sideEffects: false,
          },
        ],
      },
      output: {
        /**
         * Routes are already lazy (App.tsx), but every dependency still landed
         * in one 1.7 MB chunk, so editing a single line of our own code made
         * returning visitors re-download Ionic, Supabase and Sentry as well.
         * Splitting by library keeps the parts that rarely change cached, and
         * lets the browser fetch them in parallel.
         */
        manualChunks(id: string) {
          const path = id.replace(/\\/g, '/');

          /**
           * The Sentry facade must not share a chunk with Sentry itself.
           *
           * observability/sentry.ts is imported statically by main.tsx and by
           * every service that reports an error, while the reporter it loads
           * arrives through a dynamic import. Left alone, Rollup merges the two
           * — the facade is the only module that reaches @sentry — and the
           * 151 KB reporter is back on the critical path, which is exactly what
           * the dynamic import exists to prevent. Verified by grepping the
           * built chunks: the facade's source was inside sentry-*.js.
           */
          if (path.endsWith('src/observability/sentry.ts')) return 'observability';

          if (!id.includes('node_modules')) return;
          if (id.includes('@sentry')) return 'sentry';
          if (id.includes('@ionic') || id.includes('ionicons')) return 'ionic';
          if (id.includes('@supabase')) return 'supabase';
          /**
           * React itself belongs in this chunk, not only react-dom and the
           * router.
           *
           * It used to fall through to `vendor`, and the split survived on
           * luck: react-dom in one chunk reading React out of another works
           * only while Rollup happens to evaluate them in that order. Adding
           * @capacitor/* to vendor was enough to reverse it — react-dom ran
           * first and read `__SECRET_INTERNALS_…` off an uninitialised
           * binding, which is a blank page and one console error, in the
           * browser and in the native shell alike.
           *
           * `npm run dev` never showed it: Vite serves unbundled modules
           * there, so this whole function is inert, and the e2e suite runs
           * against the dev server.
           */
          if (
            /node_modules\/(react|react-dom|scheduler)\//.test(path) ||
            id.includes('react-router') ||
            id.includes('@remix-run')
          ) {
            return 'react';
          }
          return 'vendor';
        },
      },
    },
  },
});
