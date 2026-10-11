import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { initSentry } from './observability/sentry';
import { initializeGA4, trackApiErrorStandalone } from './hooks/useAnalytics';
import { initHotjar } from './analytics/hotjar';
import { initDarkMode } from './theme/dark-mode';
import { initDeepLinks } from './native/deep-links';
import { initNativeShell, isNative } from './native/shell';
import { movedShareLink } from './utils/share-link.utils';

import '@ionic/react/css/core.css';
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';
import '@ionic/react/css/padding.css';
import '@ionic/react/css/float-elements.css';
import '@ionic/react/css/text-alignment.css';
import '@ionic/react/css/text-transformation.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';

function start(): void {
  // Sentry, once the browser is idle — see observability/sentry.ts for why it is
  // no longer imported here directly, and what that costs.
  //
  // Session Replay is deliberately not enabled either: it was the single largest
  // piece of the initial download, and crash reports plus tracing cover what this
  // app actually needs. Add replayIntegration() back if session playback is wanted.
  initSentry();

  // Syncs body.dark with the OS. Before render, so the first paint is already in
  // the right theme rather than flashing the light one.
  initDarkMode();

  // Hands the OAuth callback back to the app on a device. No-op in a browser,
  // where the redirect lands on a page and Supabase reads it off the URL itself.
  initDeepLinks();

  // Status bar and keyboard, on a device. No-op in a browser. Not awaited: the
  // first paint should not wait on a plugin bridge, and nothing on screen depends
  // on the answer.
  void initNativeShell();

  // Initialize Analytics (GA4 + Hotjar)
  initializeGA4();
  initHotjar();

  /**
   * Handle query/mutation errors globally for analytics tracking
   */
  function handleQueryError(error: unknown, queryKey?: unknown): void {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const queryKeyString = queryKey ? JSON.stringify(queryKey) : undefined;

    trackApiErrorStandalone({
      error_message: errorMessage,
      query_key: queryKeyString,
    });
  }

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 5, // 5 minutes
        refetchOnWindowFocus: false,
      },
      mutations: {
        onError: (error) => handleQueryError(error),
      },
    },
  });

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>
  );
}

/**
 * A share link, at the address the app used to open them at.
 *
 * Links are opened on the site now, and this one is sent on there before
 * anything else in this file runs. Not as a page of the app, the way the two
 * legal addresses are: by the time a page is on screen the app has started,
 * and the first thing it does is tell its analytics where it is. On this
 * address that is the token, which is all it takes to read the file. The
 * app did tell them, for as long as it opened links itself.
 *
 * Most requests for this address never reach here: `vercel.json` redirects
 * them before a byte of the app is served. What does reach here is a browser
 * the app's service worker controls, which is handed the shell for every
 * navigation without the server being asked.
 *
 * A native shell is left alone. Its window is the app: Capacitor does not
 * load another origin in it, and asks the system to open that instead, so
 * an app that did not start there would be an empty window. And nothing in
 * a shell leads to this address in the first place.
 */
const moved = isNative() ? null : movedShareLink(window.location.pathname);

if (moved) {
  window.location.replace(moved);
} else {
  start();
}
