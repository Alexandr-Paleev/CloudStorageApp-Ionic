# 0011 — Majors are taken by hand, in one deliberate piece

Accepted · shipped in v4.1.0 · [`.github/dependabot.yml`](../../.github/dependabot.yml), [`package.json`](../../package.json)

## Context

[0006](0006-dependabot-skips-majors.md) tells Dependabot not to open pull
requests for major versions, and gives the reason: a major is a migration, and
a migration needs a changelog read and a decision, which is not something an
automated pull request can supply. That record says what does *not* happen. It
has never said what does.

Left there, the policy reads as "this project does not take majors", which is
the wrong lesson and, after long enough, becomes true: the app was on Capacitor
6.2.1 — a 2024 release, from before Xcode 16 introduced script sandboxing — at
the point someone first tried to build for a device on Xcode 26.

## Decision

Majors are taken deliberately, one family at a time, by a person who has read
the release notes, with the test suite as the evidence that it worked.

A major upgrade is its own branch and its own pull request. It moves one family
together — every `@capacitor/*` package to 8, not the core alone — and it is
finished when lint, 621 unit tests, the Playwright suite and the bundle budgets
all pass, not when the install succeeds.

The first one under this policy was Capacitor 6 → 8, taken because the iOS
build needed it. It also settled the question the policy was avoiding: the
whole upgrade, including the platform that had never existed in this repository
before, took an afternoon. It moved plugin distribution from CocoaPods to Swift
Package Manager, which is why `brew install cocoapods` — the first thing the
plan called for — turned out not to be needed at all.

The second was React 18 → 19 with Ionic 8 → 9, together, because Ionic 9 is the
release that supports React 19. Measured on both sides:

| | before | after |
| --- | ---: | ---: |
| application code changed | — | none |
| unit tests | 621 in 6.81s | 621 in 6.59s |
| e2e | 41 in 1.2m | 41 in 1.1m |
| first load, gzip | 408.6 kB | 431.0 kB |
| largest chunk (ionic) | 241.5 kB | 248.4 kB |

Two things came out of it that the install alone would not have. The 22.4 kB is
one: a bundle budget turned the price of a major into a red check on the pull
request that pays it, which is the only moment anyone can weigh it. The other
is that four unit tests failed while the same interaction passed in a real
browser — Ionic 9 moved onto `@lit/react`, whose node build attaches no event
listeners, and Vitest had been resolving it. A green suite would have shipped
that silently.

## Consequences

- The contradiction between "skip majors" and a repository that takes them is
  gone: they are different halves of one policy, and both are written down.
- **Majors arrive when something asks for them, not on a schedule.** Nothing
  opens a pull request for React 19, Ionic 9 or ESLint 10; they wait for a
  reason and a person. The cost is drift — and drift is exactly what put a
  2024 mobile toolchain in front of a 2026 Xcode.
- `npm audit --omit=dev --audit-level=high` in CI remains the backstop for the
  case this policy cannot cover: a security fix that only exists behind a
  major. That reasoning belongs to [0006](0006-dependabot-skips-majors.md) and
  is unchanged.
- The test suite is what makes this affordable, and it is fair to say so out
  loud only with the measurement attached. For Capacitor: 621 unit tests and
  the full Playwright run, green before and after, with no source change
  required by the upgrade itself.
