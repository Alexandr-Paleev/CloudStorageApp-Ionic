import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Sentry from '@sentry/react';
import { env } from './env';
import { initializeGA4, trackApiErrorStandalone } from './hooks/useAnalytics';
import { initHotjar } from './analytics/hotjar';

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

// Initialize Sentry
// Session Replay is deliberately not enabled: it was the single largest piece
// of the initial download, and crash reports plus tracing cover what this app
// actually needs. Add replayIntegration() back if session playback is wanted.
Sentry.init({
  dsn: env.VITE_SENTRY_DSN,
  integrations: [Sentry.browserTracingIntegration()],
  // Performance Monitoring
  tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,
  environment: import.meta.env.MODE,
});

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
