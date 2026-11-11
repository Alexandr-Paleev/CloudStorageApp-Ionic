import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { trackApiErrorStandalone } from './hooks/useAnalytics';
import { messageOf } from './utils/postgrest-error';

/**
 * The app's query client, and where every failed query and mutation is told
 * to Google Analytics.
 *
 * On the two caches rather than in `defaultOptions`. A default `onError` is
 * replaced by a mutation's own, so the mutations that say their failure
 * themselves were never reported, four of the dashboard's among them, and
 * TanStack Query 5 has no `onError` for queries at all: a listing or a search
 * that failed reached nobody. A cache's `onError` runs for every one of them,
 * whatever they do about it themselves.
 *
 * A query is named by the first part of its key and nothing else. The rest is
 * ids, and for a search what was typed.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => told(error, String(query.queryKey[0])),
    }),
    mutationCache: new MutationCache({
      onError: (error) => told(error),
    }),
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 5, // 5 minutes
        refetchOnWindowFocus: false,
      },
    },
  });
}

/**
 * What the person did or chose, rather than something that broke: a pause, a
 * Drive not connected, a file too large for every provider here, a name the
 * rules refuse, a queue waiting for its account to sign in again. Each is
 * said on screen where it happens. Counted with the failures, they would be
 * most of what the error metric measures, since the caches hear of all of
 * them.
 */
const NOT_A_FAILURE = new Set([
  'AbortError',
  'UploadPausedError',
  'GoogleDriveAuthError',
  'FileTooLargeError',
  'NameRuleError',
  'NotSignedIn',
]);

function told(error: unknown, query?: string): void {
  /* By name rather than by class: a pause is a DOMException, which is not an
     Error everywhere. */
  const name = (error as { name?: unknown } | null)?.name;
  if (typeof name === 'string' && NOT_A_FAILURE.has(name)) return;
  trackApiErrorStandalone({
    error_message: messageOf(error) ?? 'Unknown error',
    query_key: query,
  });
}
