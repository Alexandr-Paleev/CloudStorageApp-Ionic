# Store submission readiness

What is done, what is left, and what each of the two forms wants — written down
so the answers are decided once rather than invented at the keyboard with a
review deadline in front of you.

This is a checklist, not a promise. Nothing here has been submitted, and the
project is a portfolio piece: nothing in it is for sale in a store build.

## The short version

| | Apple | Google |
|---|---|---|
| Costs | **$99/year**, unavoidable | **$25 once** |
| App builds and runs | ✅ iPhone 17 simulator, iOS 26.5 | ✅ Pixel 7 emulator, Android 15 |
| Deletion inside the app (Apple 5.1.1(v)) | ✅ `/account` | ✅ same screen |
| No purchase routes in the shell (Apple 3.1.1) | ✅ [ADR 0012](decisions/0012-the-native-build-sells-nothing.md) | ✅ same predicate |
| Native behaviour, not a framed website (4.2) | ✅ four plugins | ✅ same |
| Sign in with Apple (4.8) | ❌ **blocked on the paid account** | n/a |
| Publication | ❌ needs the paid account | ❌ needs Play Console |

Everything free has been done. The two remaining items are the two that cost
money, and one of them cannot even be *started* without paying: a Service ID
and a signing key exist only inside a paid Apple Developer account.

## What is genuinely blocking

### Sign in with Apple — Apple guideline 4.8

Required because the app offers Google sign-in. An app that offers a
third-party login must also offer Apple's, or an equivalently
privacy-preserving option.

It cannot be written speculatively — the pieces are account-bound:

1. **Apple Developer portal**: an App ID with *Sign in with Apple* enabled, a
   Services ID for the web/Supabase callback, and a `.p8` key. All three are
   behind the $99 membership.
2. **Supabase → Authentication → Providers → Apple**: Services ID, Team ID, Key
   ID and the `.p8` contents.
3. **The app**: a second button beside Google in `src/pages/Login.tsx` calling
   `supabase.auth.signInWithOAuth({ provider: 'apple' })`, and on a device the
   same `com.cloudstorage.app://auth/callback` deep link that Google already
   uses — `src/native/deep-links.ts` needs no change for it.

Step 3 is perhaps two hours. Steps 1 and 2 are the paywall.

### Android's fourteen-day wait

A **personal** Play Console account created after November 2023 must run a
closed test with **12 testers for 14 continuous days** before it may apply for
production access. That is calendar time, not work, and it cannot be
compressed — so if Android is wanted at all, the Play Console account and the
closed track should be opened early and left running while everything else
happens.

## Apple: App Privacy answers

Filled in App Store Connect before the first submission. The answers below
follow from what the code actually does; each names where to check it.

| Data type | Collected | Linked to identity | Tracking | Purpose | Where |
|---|---|---|---|---|---|
| Email address | Yes | Yes | No | App functionality (account) | `profiles.email`, Supabase Auth |
| Name | Yes | Yes | No | App functionality | `profiles.display_name`, optional |
| User content (files) | Yes | Yes | No | App functionality | the whole app |
| Purchase history | Yes | Yes | No | App functionality (tier) | `profiles.stripe_*`, Stripe |
| Identifiers (user ID) | Yes | Yes | No | App functionality, analytics | `auth.users.id` |
| Crash data | Yes | No | No | App functionality | Sentry, `src/observability/` |
| Performance data | Yes | No | No | App functionality | Sentry tracing, 20% sample in prod |
| Product interaction | Yes | No | No | Analytics | GA4 and Hotjar |
| Coarse location | No | — | — | — | never requested |
| Contacts, photos, health, financial | No | — | — | — | card data never touches the app; Stripe Checkout is hosted |

**Tracking is "No" across the board.** Nothing here follows a person across
other companies' apps or websites, and no data is shared with a data broker.
GA4 runs with `anonymize_ip` (`src/hooks/useAnalytics.ts`), and no ad SDK is
installed. That answer means **no App Tracking Transparency prompt is needed** —
do not add one "to be safe": asking for permission the app does not use is
itself a rejection reason.

**Analytics are optional at build time.** `VITE_GA4_MEASUREMENT_ID`,
`VITE_HOTJAR_SITE_ID` and `VITE_SENTRY_DSN` are all optional in `src/env.ts`,
and each SDK is skipped entirely when its variable is absent. A store build with
none of them set collects only the first five rows above — which is the simpler
form to fill in, and worth considering.

## Google: Data safety answers

Same substance, different form. Google additionally asks two things Apple does
not:

- **Is data encrypted in transit?** Yes — every endpoint is HTTPS, and the
  Supabase, Stripe, Cloudinary and R2 SDKs refuse anything else.
- **Can users request deletion?** Yes, in the app at `/account`. Google also
  wants a **publicly reachable URL** for deletion requests from people who no
  longer have the app installed. The privacy policy page is the natural home for
  it: <https://cloud-storage-app-ionic-v0.vercel.app/privacy-policy>. Add a
  paragraph there naming the in-app path and an email before submitting; the
  page exists but does not say this yet.

## Assets

| Asset | Have | Need |
|---|---|---|
| iOS app icon | ✅ 1024×1024, `ios/App/App/Assets.xcassets/AppIcon.appiconset/` | — |
| Android launcher icon | ✅ generated into `mipmap-*` | a proper adaptive icon is worth doing by hand |
| iPhone screenshots | ❌ | 6.7″ **and** 6.5″, 3–10 each |
| iPad screenshots | ❌ | only if the app ships as universal — it can be iPhone-only |
| Play screenshots | ❌ | phone, 2–8; plus a 1024×500 feature graphic |
| Play icon | ❌ | 512×512 PNG |
| Promo text / description | ❌ | the README's opening two paragraphs are most of it |

`docs/screenshots/ios-login.png` and `android-login.png` were taken with
`xcrun simctl io … screenshot` and `adb exec-out screencap`; the store sizes come
from the same commands on the right simulator, so this is an hour, not a design
project.

## Review notes to hand Apple

Two things reviewers ask for, both already true:

- **A demo account.** "Just looking? Open a demo account" on the login screen
  mints one with no sign-up. Say so in App Review notes rather than sending
  credentials — it is a real account with the same RLS, quota and code path.
- **Why there is no purchase.** The reviewer will see a storage limit and no way
  to raise it. Note that the tier is sold on the web only and the app
  deliberately shows no route to it, per 3.1.1. Without that sentence it reads
  as a broken upgrade flow.

## Also worth doing before submitting

- **Export compliance.** The app uses only standard HTTPS, so
  `ITSAppUsesNonExemptEncryption = false` in `Info.plist` answers it once
  instead of on every upload.
- **Privacy manifests.** Apple requires `PrivacyInfo.xcprivacy` for apps and for
  certain third-party SDKs. Check whether the Capacitor plugins and Sentry ship
  their own at the version pinned here before assuming they do.
- **A `LaunchScreen` that is not the Capacitor default**, which is the most
  common cosmetic rejection in this category.

## What this app will not claim

No in-app purchase, no subscription, no restore-purchases button — the native
build sells nothing, deliberately, and [ADR 0012](decisions/0012-the-native-build-sells-nothing.md)
records why In-App Purchase is deferred rather than refused. If that changes,
StoreKit, server-side receipt validation and a reconciliation with the
`profiles` column Stripe's webhook owns are the work, and none of it is small.
