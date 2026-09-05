# 0012 — The native build sells nothing

Accepted · shipped in v4.3.0 · [`src/utils/billing.utils.ts`](../../src/utils/billing.utils.ts)

## Context

The app sells one thing: the Pro tier, 5 GB of storage for $9 a month, taken
through Stripe Checkout. On the web that is unremarkable.

In an App Store build it is a rejection. Guideline 3.1.1 requires digital
content consumed inside an app to be sold through In-App Purchase, and Pro
storage is exactly that. The rule reaches further than the transaction: an app
may not show buttons or links steering the user to buy the same thing
elsewhere, so redirecting the plans page somewhere friendlier does not satisfy
it either.

Three surfaces reach billing, and all three had to be closed rather than
softened: the plans page itself, the header button on the dashboard that is its
only permanent entry point, and `UpgradeBanner`, which appears at 80% of quota.

## Decision

The native shell offers no way to buy anything. `billingIsOffered()` is the one
predicate all three surfaces ask, and it is false whenever
`Capacitor.isNativePlatform()` is true — regardless of `VITE_BILLING_ENABLED`,
which keeps its own older meaning for a deployment with no `STRIPE_*` keys.

It is a runtime check, not a build-time one, for the same reason `apiUrl()` is:
one `npm run build` produces both the bundle a browser downloads and the bundle
Capacitor copies into the app. A second build configuration would be a second
thing to keep in step, and the first time it fell out of step the symptom would
be an App Store rejection weeks later.

In-App Purchase was considered and deferred rather than rejected. It is not a
switch: StoreKit, server-side receipt validation, and a reconciliation between
Apple's subscription state and the `profiles` table that Stripe's webhook owns
today — two sources of truth for one column. That is worth building when
someone actually buys from a phone, and this app is published as a portfolio
piece.

## Consequences

- **A native user who fills 500 MB has no way to buy more from inside the app.**
  This is the cost, stated plainly. They can upgrade on the web with the same
  account, and the tier travels with the profile.
- The web app is untouched. Its storefront, the customer portal and the Stripe
  webhook all behave exactly as before, and the same account is Pro in both
  places the moment it is Pro in one.
- `VITE_BILLING_ENABLED` did not change meaning, which matters because it also
  gates a public demo running on test keys — see the note in `env.ts`.
- The check is asserted at a call site as well as on the predicate.
  `UpgradeBanner` has a test that renders it in a simulated native shell,
  because the way this regresses is not someone deleting `billingIsOffered()` —
  it is someone reaching past it for `env.VITE_BILLING_ENABLED`, which reads
  correct and is correct on the web.
- Sign in with Apple (guideline 4.8) and in-app account deletion (5.1.1(v))
  remain open before a submission is possible. Neither is affected by this
  decision; both are recorded here so the list is not mistaken for finished.
