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
