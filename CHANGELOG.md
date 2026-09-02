# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Entries say what changed and, where it matters, what was wrong before — the
reasoning behind the larger decisions lives in
[`docs/decisions/`](docs/decisions/).

## [Unreleased]

Nothing yet.

## [4.0.0] — 2026-09-02

### Added

- **A demo account, without signing up.** "Just looking? Open a demo account" at
  the foot of the login page mints a private account seeded with a few files and
  sweeps it after 24 hours. It is a real account — same RLS, same quota, same
  Stripe test-mode checkout — because a demo on a different code path stops
  proving anything.
- **Rate limits on every route that mints something.** `/api/share`,
  `/api/r2/presign-upload` and `/api/cloudinary/*` count requests per account
  after the token check and per address before it, and answer `429` with
  `Retry-After`. Revoking a share link is deliberately exempt
  ([ADR 0007](docs/decisions/0007-rate-limits-are-per-instance.md)).
- **Security headers.** `vercel.json` sends a Content-Security-Policy,
  `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` and
  `X-Frame-Options`. `lib/csp.test.ts` parses the policy out of the JSON and
  asserts that every origin the app injects a script from is allowed.
- **Open Graph and Twitter Card tags**, so a link to the demo previews as
  something rather than as a bare URL.
- **A React test suite.** Vitest now runs two projects — `server` under node for
  `api/` and `lib/`, `client` under jsdom for `src/`. Coverage used to exclude
  `src/` with a note saying Playwright covered the pages; it did not.
- **E2E tests that touch the product**, not only its shell: the file lifecycle,
  a share link opened by an anonymous second browser context, quota refusals,
  folder scoping and the demo entry point. Every test gets its own account from
  a fixture rather than sharing one.
- **Resumable uploads.** A file over 16 MB goes to R2 in parts, each retried on
  its own, and can be paused and picked up again — including after a reload, a
  crash or a lost connection. The ETags and the file itself are kept in
  IndexedDB, so nothing about resuming needs server state
  ([ADR 0009](docs/decisions/0009-resumable-uploads-keep-state-in-the-browser.md)).
  The upload page lists unfinished uploads with how much of each is already in
  storage, and offers to resume or discard them. Covered end to end with R2 stubbed
  through `page.route`: parts, a pause, a reload, a resume that sends only what
  was missing, a discard that reaches `multipart-abort`, and a part the network
  refused once.
- **A bundle-size budget** (`npm run size`) that fails CI when what the browser
  fetches before first paint grows past a ceiling set just above today's build,
  and prints the table onto the run page.
- **Lighthouse CI** (`npm run lighthouse`) against the built `dist/`, asserting
  accessibility, best practices and SEO at ≥ 95 and performance at ≥ 80.
- **Architecture decision records** in `docs/decisions/`, a security policy in
  `SECURITY.md`, and this changelog.

### Changed
- **The three R2 routes became one.** `/api/r2/presign-upload`,
  `presign-download` and `delete` now resolve to `api/r2/[action].ts`, which
  also serves the four multipart actions. The paths did not change; the Hobby
  plan's twelve-function ceiling was already reached, and this returned two
  slots while adding four routes
  ([ADR 0008](docs/decisions/0008-two-actions-one-function.md)).
- A paused or cancelled upload is no longer retried. `isRetriableError` treated
  an abort as an unknown failure worth another attempt, which restarted work
  the user had just stopped — three times, with backoff.

- **Cloudinary uploads are signed per request.** They used to go through an
  unsigned upload preset, which is writable by anyone holding the cloud name —
  and the cloud name ships in the client bundle. `/api/cloudinary/sign` now
  issues a signature after checking the quota
  ([ADR 0008](docs/decisions/0008-two-actions-one-function.md)).
- **Sentry loads once the browser is idle** instead of before first paint, which
  takes 51 KB gzipped off the critical path. The trade-off — no pageload
  transaction — is stated in [ADR 0005](docs/decisions/0005-sentry-loads-when-idle.md).
- The dark theme applies `body.dark`, so it actually takes effect.
- `Login.tsx` redirects by declaration (`<Navigate replace />`) rather than
  calling `navigate()` during render.
- The Firebase-era deployment stack — `firebase.json`, `.firebaserc`,
  `netlify.toml`, `functions/` and eleven other files — is gone, along with the
  `npm run deploy` script that deployed to a host this project left long ago.

### Fixed

- **The storage quota is now enforced in the database.** It was checked in one
  handler, covering one provider out of three — and not the ones production
  uses. A trigger on `public.files` refuses an insert that would cross the
  limit, takes a row lock so two parallel uploads cannot both pass, and keeps
  `profiles.bytes_used` as a counter instead of re-summing every row on each
  upload ([ADR 0004](docs/decisions/0004-quota-lives-in-the-database.md),
  migration `007`).
- **A policy on `files` that undid link revocation.** A `FOR SELECT TO public`
  policy granted access to any file that had ever been shared — no token, no
  expiry check, no revocation check. It was not exploitable only because the
  subquery it used was itself constrained by RLS on `shared_links`; one
  natural-looking policy added there would have exposed every shared file at
  once. Removed in migration `006`.
- **`shared_links` existed in no migration.** The table was created by hand when
  sharing was built. Anyone following the README got `500` from `/api/share`,
  for a feature shown in three screenshots. Added as migration `005`, with the
  shape taken from the live database rather than reconstructed.
- **Migration `004` was not safe to re-run**, despite saying so: `RETURN` inside
  a `DO` block leaves the block, not the script, so seven statements ran
  unguarded and the migration failed on a fresh schema.
- **The Storage bucket and its policies were never written down** either — set
  up by hand, described in the README as "create a private bucket". Migration
  `006` defines the bucket and all three policies.
- README pointed at port 5173 while the dev server runs on 8100 with
  `strictPort`, listed only migrations `000`–`003`, and claimed a quota
  enforcement that only one path had.
- **The static legal pages**, which nothing else in the app links to and which
  the earlier link sweep therefore missed: four GitHub links pointing at a
  username that does not exist, body text at `#999` on white (2.8:1, below the
  4.5:1 that text needs), links distinguished by colour alone, and no meta
  description. Found by the first Lighthouse run, which scored the terms page
  84 for accessibility; all three pages now score 100.

### Security

- `VITE_CLOUDINARY_API_KEY` no longer appears in the documented setup. `env.ts`
  parses `import.meta.env` as an object, so Vite inlines **every** `VITE_`
  variable into the bundle, not only the ones the code reads. No real secret was
  exposed — checked for each one by name — but the variable had no business
  being there.

## [3.1.0] — 2026-08-30

### Added

- **Public share links.** Any file can be sent as a link that needs no account
  on the other side. Links expire (7 days by default), can be revoked from the
  file page, and are listed per file with their state: active, expired, revoked.
  The recipient sees name, size, type and a download button — nothing about the
  owner.
- CI on **every push**, not only on `main`; a branch waiting for its pull
  request used to be checked by nothing.
- Dependabot, scoped to minor and patch, grouped by family
  ([ADR 0006](docs/decisions/0006-dependabot-skips-majors.md)).
- Screenshots, an architecture diagram drawn around the actual trust boundary,
  and a table of the security decisions this project accumulated the hard way.

### Fixed

- **`shared_links` shipped with `USING (true)` for role `public`** under a policy
  named "Anyone can read shared links by token". One request with the published
  anon key collected every token in the database. Tokens are now stored as
  SHA-256 hashes and looked up only in `/api/share`
  ([ADR 0003](docs/decisions/0003-share-tokens-are-stored-hashed.md),
  migration `004`).
- `assertServiceRoleKey` refuses to start on a key whose `role` claim is wrong.
  An anon key pasted into `SUPABASE_SERVICE_ROLE_KEY` fails silently — RLS
  reduces every server-side query to zero rows — and that configuration sat in
  three environments for 221 days. The postmortem is in the README.
- `TIER_LIMITS` had drifted into seven places; it now lives in `lib/tiers.ts`.
- `SUPABASE_SCHEMA.sql` duplicated migration `001` and guarded nothing, so the
  documented setup order failed. Migrations are the only definition of the
  schema now.

### Tests

- 193 unit tests, up from 114; 86.6% statements over `api/` and `lib/`.

## [3.0.0] — 2026-08-26

### Added

- **Billing.** Free (500 MB) and Pro ($9/mo, 5 GB), a `profiles` table holding
  tier and subscription state, Stripe Checkout for upgrades and the Customer
  Portal for management, with a webhook that syncs both directions. The public
  deployment runs on test keys and says so.
- **Dropbox** as a Pro provider over OAuth 2.0 with PKCE, and a provider picker
  on the upload screen.
- A test suite — 31 unit tests, 15 e2e — and GitHub Actions running lint, both
  type-checks and both suites on every pull request.

### Fixed

- **Any user could grant themselves Pro.** The `profiles` UPDATE policy covered
  every column, including `tier`; RLS has no column-level granularity
  ([ADR 0002](docs/decisions/0002-billing-is-server-write-only.md), migration `002`).
- **R2 credentials were in the public bundle.** `VITE_R2_ACCESS_KEY_ID` and its
  secret were inlined by Vite and readable in DevTools. R2 now runs behind
  `/api/r2/*`, which signs URLs server-side
  ([ADR 0001](docs/decisions/0001-presigned-uploads-not-a-proxy.md)).
- Any authenticated user could delete anyone's Cloudinary asset; ownership is
  verified before `destroy()`.
- Dropbox refresh tokens moved out of `localStorage`, where any XSS could read
  them, into `dropbox_connections` behind RLS with no policies (migration `003`).
- Dropbox OAuth had no `state` parameter.
- A second checkout is refused with `409` when a subscription is already active —
  the client hid the button, the route did not, and Stripe billed for every
  extra subscription.
- Upgrades never applied: Stripe moved `current_period_end` into
  `subscription.items.data[0]` in API version `2025-03-31.basil`, so the webhook
  built an `Invalid Date` and threw.
- Files inside folders never counted toward the quota.
- An account over its limit displayed a flat `100.0%`, and quota errors printed
  raw byte counts.

## [2.1.0] — 2026-02-07

### Added

- Google Analytics 4 and Hotjar, with `data-hj-suppress` so file names stay out
  of session recordings.
- Sentry for runtime exceptions.

### Fixed

- TypeScript declaration errors in `Upload.tsx` and `tsconfig.json`.
- Platform-specific `esbuild` failures on Vercel builds.

## [2.0.0] — 2026-01-20

### Added

- Redesigned dashboard, login, upload and file view.
- Social sharing and copyable download links.
- Privacy Policy and Terms of Service pages.

### Fixed

- PWA icon caching.

## [1.0.0] — 2026-01-10

First stable release: email and Google sign-in, file upload with preview,
folders, rename and delete, four storage providers with automatic routing, a
500 MB free tier, and an installable PWA with offline support.

[unreleased]: https://github.com/Alexandr-Paleev/CloudStorageApp-Ionic/compare/v4.0.0...HEAD
[4.0.0]: https://github.com/Alexandr-Paleev/CloudStorageApp-Ionic/compare/v3.1.0...v4.0.0
[3.1.0]: https://github.com/Alexandr-Paleev/CloudStorageApp-Ionic/compare/v3.0.0...v3.1.0
[3.0.0]: https://github.com/Alexandr-Paleev/CloudStorageApp-Ionic/compare/v2.1.0...v3.0.0
[2.1.0]: https://github.com/Alexandr-Paleev/CloudStorageApp-Ionic/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/Alexandr-Paleev/CloudStorageApp-Ionic/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/Alexandr-Paleev/CloudStorageApp-Ionic/releases/tag/v1.0.0
