import type { ScopeContext } from '@sentry/core';
import { env } from '../env';
import { withoutSecrets } from './scrub';
import { whenLoadedAndIdle } from '../utils/when-loaded';
import { isPostgrestError, type PostgrestErrorBody } from '../utils/postgrest-error';

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
        /* Every address in what is sent is cut at its `?` and its `#`. This
           one collector is started whatever the address is, because the
           errors most worth having are the ones at startup, and a sign-in
           comes back with its tokens in the address. So it is what leaves
           that is cleaned, on both of the roads out: scrub.ts, which also
           cuts a stored file's name out of the path of an upload. */
        beforeSend: withoutSecrets,
        beforeSendTransaction: withoutSecrets,
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
 * Starts loading once the page has loaded and the browser is idle.
 *
 * The fetch then competes with nothing the user is waiting on. An idle moment
 * alone was not enough: one could fall between two of the page's own files,
 * and the reporter arrived while the login page was still being drawn.
 * `utils/when-loaded.ts` has the details, and Google Analytics and Hotjar wait
 * the same way.
 */
export function initSentry(): void {
  if (!enabled) return;

  whenLoadedAndIdle(() => void load());
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

class PostgrestError extends Error {
  override name = 'PostgrestError';
}

/** One object is always the same Error — see `reportable`. */
const asErrors = new WeakMap<PostgrestErrorBody, PostgrestError>();

/**
 * A failed query, as an Error Sentry can tell from the next one.
 *
 * Captured as it comes, a PostgREST error is an object, and Sentry gave every
 * one the same title, "Object captured as exception with keys: code, details,
 * hint, message", with the object serialised beside it: a policy refusing a
 * row and a statement that timed out were one issue, told apart only by
 * opening each event. As an Error named PostgrestError it is titled by what
 * the database said, its code is a tag and a part of the fingerprint, so each
 * kind of failure is an issue of its own, and the details and the hint are a
 * context of their own. Those are the fields Sentry was sent before, in
 * `__serialized__`, and scrub.ts reads them like every other string.
 *
 * One object is always the same Error. Sentry marks what it has captured and
 * drops a second capture of it, and the app leans on that: a service reports
 * a failed query and throws it, and the offline queue reports what reaches it
 * again. A new Error for each capture would make that one event two.
 *
 * A context given as a Scope or as a function is passed on as it is.
 */
function reportable(error: unknown, context: CaptureContext): [unknown, CaptureContext] {
  if (!isPostgrestError(error)) return [error, context];

  let reported = asErrors.get(error);
  if (!reported) {
    reported = new PostgrestError(error.message);
    asErrors.set(error, reported);
  }

  if (context !== undefined && !isScopeFields(context)) return [reported, context];

  const { code, details, hint } = error;
  const scope: Partial<ScopeContext> = {
    ...context,
    tags: { ...context?.tags, 'postgrest.code': code },
    contexts: { ...context?.contexts, postgrest: { code, details, hint } },
    fingerprint: context?.fingerprint ?? ['{{ default }}', code || 'no code'],
  };
  return [reported, scope];
}

function isScopeFields(context: NonNullable<CaptureContext>): context is Partial<ScopeContext> {
  return typeof context === 'object' && Object.getPrototypeOf(context) === Object.prototype;
}

/** Same signature as the real one, so call sites read unchanged. */
export function captureException(error: unknown, context?: CaptureContext): void {
  const [reported, scope] = reportable(error, context);
  report((module) => module.captureException(reported, scope), error);
}

export function captureMessage(message: string, context?: CaptureContext): void {
  report((module) => module.captureMessage(message, context), message);
}
