/**
 * The four things this app uses from Sentry, and nothing else.
 *
 * This file exists purely so the dynamic import in sentry.ts can be
 * tree-shaken. `import('@sentry/react')` resolves to the whole module
 * namespace, which Rollup has to keep intact — doing that directly grew the
 * Sentry chunk from 151 KB to 494 KB, because every integration the package
 * ships (replay, feedback, profiling) became reachable.
 *
 * Importing a module with a handful of re-exports gives Rollup a namespace
 * small enough to shake against.
 */
export { init, captureException, captureMessage, browserTracingIntegration } from '@sentry/react';
