# 0005 — Sentry loads after first paint, and Session Replay stays off

Accepted · unreleased · [`src/observability/sentry.ts`](../../src/observability/sentry.ts)

## Context

Sentry was imported at the top of `main.tsx` and of `ErrorBoundary.tsx`. That
put 151 KB — 51 KB gzipped, about a ninth of the gzipped shell — in front of the
first paint. A crash reporter has nothing to report until the app is running, so
none of that download was buying anything at the moment it was paid for.

## Decision

Every module imports a facade instead. The real client is imported dynamically
once the browser is idle; events raised before it arrives are queued and flushed
when it lands. The call shape is unchanged, so
`Sentry.captureException(error, { tags, extra })` still reads the same at every
call site.

Session Replay is not enabled. It was the single largest piece of the initial
download, and crash reports plus tracing cover what this app needs.

## Consequences

- The shell renders without the reporter. With no DSN configured the chunk is
  never fetched at all, so a fork with no Sentry project pays nothing.
- **`browserTracingIntegration` no longer sees the initial pageload
  transaction**, because it is installed after the page has loaded. Navigations
  and fetch/XHR spans are unaffected; errors — the reason it is here — are not
  affected at all.
- An error thrown in the first few hundred milliseconds is queued rather than
  sent immediately. If the tab is closed inside that window it is lost.
- Session playback of a bug report is not available. `replayIntegration()` is a
  one-line addition if that changes, at a known cost.
