# 0006 — Dependabot skips majors, and `npm audit` in CI backstops that

Accepted · shipped in v3.1.0, amended after · [`.github/dependabot.yml`](../../.github/dependabot.yml)

## Context

The first Dependabot run proposed seven major upgrades at once — Capacitor 6 to
8, Ionic 8 to 9, TypeScript 5 to 7, react-router 6 to 7, ESLint 8 to 10 — two of
them failing CI outright. A major is a migration: it needs a changelog read and
a decision, which is exactly what an automated pull request cannot supply.

## Decision

Ignore majors for every dependency; take minors and patches weekly, grouped by
family so that `@aws-sdk`'s three packages move together.

## Consequences

- Weekly updates stay reviewable, and nothing in the queue is a rewrite.
- **The original justification was wrong, and the amendment is the point of this
  record.** The rule used to be defended with "majors are where security fixes
  land" — sometimes the fix is *only* in the next major, and then this rule means
  nobody is told at all. Four high-severity `undici` advisories reached
  production dependencies through `@vercel/node` and sat there with every check
  green.
- The backstop is `npm audit --omit=dev --audit-level=high` in CI, which fails
  the build rather than waiting for a pull request this rule will never allow.
  The comment in `dependabot.yml` keeps a marker where the wrong sentence stood.
- Majors are still owed a periodic manual pass. Nothing automates that, and this
  record does not pretend otherwise.
