import { env } from '../env';

/**
 * Sentry, loaded off the critical path.
 *
 * It used to be imported at the top of main.tsx and of ErrorBoundary.tsx, which
 * put 151 KB (51 KB gzipped) of crash reporter in front of the first paint —
 * about a ninth of the gzipped shell, spent before the user could see anything.
 * Nothing about a crash reporter needs to be there: it has nothing to report
 * until the app is running.
 *
 * Every module now imports this facade instead. The call shape is unchanged, so
 * `Sentry.captureException(error, { tags, extra })` still reads the same at the
 * call sites; what changed is that the real module arrives later, and events
 * raised before it does are queued rather than dropped.
 *
 * The trade-off, stated plainly: browserTracingIntegration no longer sees the
 * initial pageload transaction, because it is installed after the page has
 * loaded. Navigations and fetch/XHR spans are unaffected, and errors — the
 * reason this is here at all — are not affected at all.
 */

type SentryModule = typeof import('./sentry-client');
type CaptureContext = Parameters<SentryModule['captureException']>[1];

let sentry: SentryModule | null = null;
let loading: Promise<SentryModule | null> | null = null;

/** Raised before the module finished arriving; flushed once it has. */
const queued: ((module: SentryModule) => void)[] = [];

/** Without a DSN there is nowhere to send anything, so the chunk is never even
 *  fetched — a fork with no Sentry project pays nothing for this file. */
const enabled = Boolean(env.VITE_SENTRY_DSN);

function load(): Promise<SentryModule | null> {
  if (!enabled) return Promise.resolve(null);
  if (loading) return loading;

  loading = import('./sentry-client')
    .then((module) => {
      module.init({
        dsn: env.VITE_SENTRY_DSN,
        integrations: [module.browserTracingIntegration()],
        tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,
        environment: import.meta.env.MODE,
      });

      sentry = module;
      for (const replay of queued.splice(0)) replay(module);
      return module;
    })
    .catch((error) => {
      // An ad blocker refusing the chunk must not take the app with it.
      if (import.meta.env.DEV) {
        console.warn('[sentry] could not load', error);
      }
      return null;
    });

  return loading;
}

/**
 * Starts loading once the browser is idle.
 *
 * requestIdleCallback rather than a timer so the fetch competes with nothing
 * the user is waiting on; the timeout is the ceiling for a tab that never goes
 * idle, and the setTimeout branch covers Safari versions without it.
 */
export function initSentry(): void {
  if (!enabled) return;

  const start = () => void load();
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(start, { timeout: 4000 });
  } else {
    setTimeout(start, 2000);
  }
}

/**
 * Runs `send` against the real module, now or as soon as it arrives.
 *
 * An event raised in the window before the module lands is queued, not lost —
 * which matters, because the events most worth seeing are the ones that happen
 * during startup.
 */
function report(send: (module: SentryModule) => void, subject: unknown): void {
  if (!enabled) {
    if (import.meta.env.DEV) console.warn('[sentry] no DSN configured:', subject);
    return;
  }

  if (sentry) {
    send(sentry);
    return;
  }

  // Bounded: a crash loop firing thousands of events before the module lands
  // should not become the memory leak that finishes the tab off.
  if (queued.length < 50) queued.push(send);
  void load();
}

/** Same signature as the real one, so call sites read unchanged. */
export function captureException(error: unknown, context?: CaptureContext): void {
  report((module) => module.captureException(error, context), error);
}

export function captureMessage(message: string, context?: CaptureContext): void {
  report((module) => module.captureMessage(message, context), message);
}
