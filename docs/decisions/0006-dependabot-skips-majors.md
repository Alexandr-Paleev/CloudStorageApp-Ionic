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
- The backstop is a production-dependency audit in CI, which fails the build
  rather than waiting for a pull request this rule will never allow. The comment
  in `dependabot.yml` keeps a marker where the wrong sentence stood.
- *Amended in v4.2.0:* that audit was `npm audit --omit=dev --audit-level=high`
  until the registry answered 503 twice in one day and failed a required check
  over someone else's uptime. It is now
  [`scripts/audit-production.mjs`](../../scripts/audit-production.mjs), which
  separates a verdict from an unreachable endpoint. The threshold, the
  `--omit=dev` and the reasoning above are unchanged.
- *Amended in v4.11.1:* the other half of the old sentence, "minor and patch
  still arrive weekly", was not true either. `open-pull-requests-limit` was 5,
  a group counts as one pull request, and the groups are opened first, so an
  update outside them got a slot only in a week when fewer than five groups had
  something. The rest were dropped rather than queued, to lose to the same
  groups the next Monday. On 2026-10-19 that was seventeen updates, vite 8.3
  among them six weeks after its release, and two days later three advisories
  against vite 8.2.2 had no pull request to carry the fix. Every update is in a
  group now — the families, and `runtime` and `tooling` for the rest — and the
  limit stays above the number of groups. The comment above the limit says why.
- Majors are still owed a periodic manual pass. Nothing automates that, and this
  record does not pretend otherwise.
