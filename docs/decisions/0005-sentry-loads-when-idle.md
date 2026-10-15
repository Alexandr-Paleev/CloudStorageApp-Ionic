# 0005 — Sentry loads after first paint, and Session Replay stays off

Accepted · shipped in v4.0.0 · [`src/observability/sentry.ts`](../../src/observability/sentry.ts)

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

## Update — 2026-10-15

An idle moment alone turned out to come too early. One can fall between two of
the page's own files: in production, under Lighthouse, the reporter's chunk
was asked for 0.3 to 0.4 s into the load, before the login page had drawn its
largest element. Sentry now waits for the load event and then for an idle
moment, through [`src/utils/when-loaded.ts`](../../src/utils/when-loaded.ts),
and Google Analytics and Hotjar wait the same way (decision 0015). The window
in which an error is queued rather than sent is longer by however long the
page takes to load; nothing raised in it is dropped.
