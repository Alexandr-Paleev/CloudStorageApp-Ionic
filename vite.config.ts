import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { devApi } from './vite-plugin-dev-api';

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
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/,
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
      output: {
        /**
         * Routes are already lazy (App.tsx), but every dependency still landed
         * in one 1.7 MB chunk, so editing a single line of our own code made
         * returning visitors re-download Ionic, Supabase and Sentry as well.
         * Splitting by library keeps the parts that rarely change cached, and
         * lets the browser fetch them in parallel.
         */
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return;
          if (id.includes('@sentry')) return 'sentry';
          if (id.includes('@ionic') || id.includes('ionicons')) return 'ionic';
          if (id.includes('@supabase')) return 'supabase';
          if (
            id.includes('react-dom') ||
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
