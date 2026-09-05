# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Entries say what changed and, where it matters, what was wrong before — the
reasoning behind the larger decisions lives in
[`docs/decisions/`](docs/decisions/).

## [Unreleased]

### Added

- **`docs/store-submission.md`** — what an App Store and Play submission would
  need, decided once rather than invented at the keyboard with a review deadline
  in front of you. It carries the App Privacy and Data safety answers with the
  file each one is derived from, the asset sizes, and the two review notes worth
  handing Apple: that the demo account is on the login screen, and that the
  missing upgrade button is deliberate rather than broken.

  Its useful half is what it says is *blocked*. Sign in with Apple cannot be
  written speculatively — the Services ID and the `.p8` key exist only inside a
  paid developer account — and a personal Play Console account must run a closed
  test with twelve testers for fourteen days before it may apply for production.
  That second one is calendar time, so it is the thing to start first if Android
  publication is ever wanted.


- **CodeQL and gitleaks, in their own workflow.** `npm run audit:prod` already
  covers published advisories in what ships; neither of these does that.

  CodeQL reads this project's own code for the classes of bug an advisory never
  mentions, because nobody else wrote it. It runs the `security-and-quality`
  suite rather than the default, since the extra rules are the ones about code
  that is merely wrong rather than exploitable — which is most of what a
  reviewer would have said.

  gitleaks reads the *history* for credentials, at full clone depth: a secret
  removed in the next commit is still in the repository. Not hypothetical here —
  v3.1.0's postmortem is an anon key that sat in three environments for 221
  days, and what let it last was that nothing ever looked. Run before committing
  the check: clean across 132 commits, which is the answer worth having on
  record rather than assumed.

  The binary, not `gitleaks/gitleaks-action`: the tool is MIT, the action is
  under a commercial EULA that happens to be free for public repositories, and
  taking the licensed wrapper for a one-line invocation buys a licence question
  and some telemetry in exchange for nothing. Pinned to 8.30.1 — "latest" in a
  security check is the check changing underneath you.

  Both run weekly as well as on a diff, because advisories and rules move
  without this repository changing.

- **Two coverage badges, not one.** The numbers were already printed into the
  Actions run summary and read by nobody who did not open it. They are now on
  the README.

  Two, because `scripts/coverage-summary.js` already refuses to blend them and
  says why: the handlers and the React layer are covered by separate suites in
  separate runtimes, and one percentage hides which half a pull request moved.
  A single badge would do that to a reader who never opens the run, and it would
  flatter the figure — the server half is the half that decides access, money
  and quota, and it is at 90.9%. The client badge reads 32.7% and is red, which
  is the point: `src/pages` has no tests at all, about six hundred statements.
  An average would read ~48% and sound fine.

  Published to an orphan `badges` branch that nothing builds from. shields.io
  reads whatever `raw.githubusercontent` serves, so a branch is enough — and a
  branch nothing builds from cannot start a loop, which committing a badge to
  `main` would. No gist and no third-party coverage service: both would work,
  and both would put a 120-byte file somewhere this repository does not control.
## [4.3.0] — 2026-09-05

### Added

- **An account can be deleted, from inside the app.** Both stores require it of
  anything that lets a person sign up — Apple in guideline 5.1.1(v), Google in
  its account deletion policy — and neither accepts a support address or a
  deactivation. There was no way to do it at all: `grep` for a deletion path
  found only the sweep that retires demo accounts.

  `/account`, reached from the dashboard header, shows which account is signed
  in and deletes it behind a typed confirmation. `DELETE /api/account/delete`
  does the work, because most of it is beyond what a browser is allowed to do:
  `auth.admin.deleteUser` needs the service-role key, and the R2 and Cloudinary
  credentials never leave a function.

  The order is the interesting part. `files.user_id` and `folders.user_id` are
  plain UUID columns with **no** foreign key to `auth.users` — only `profiles`
  and `dropbox_connections` cascade — so deleting the account first would strand
  every row and every byte it owns, invisibly: the rows stay, RLS keeps matching
  them against an `auth.uid()` nobody will present again, and the storage stays
  paid for. Bytes go first, then rows, then the user. Each provider stores under
  a per-user prefix, which is what makes that possible without walking the rows
  — and walking the rows would miss objects whose upload half-failed.

  Storage failures are collected and reported rather than thrown: someone who
  has asked to be deleted must not be left with an account because one bucket
  was briefly unreachable. A failure to delete the *user* does throw, because
  that is the part the request was actually for.

  What it cannot reach is documented in the README rather than shown in the
  flow: files the app placed in the user's own Google Drive or Dropbox stay
  there. They live in storage the person controls, put there with their own
  OAuth grant, and the app holds no standing authority over either.

- **An Android app, built and run** — `android/` is in the repository and the app
  launches on a Pixel 7 emulator. The README had promised Android since v1, and
  the last release had to say honestly that it had never been built. Now it has.

  It needed one native thing iOS already had: an `intent-filter` for
  `com.cloudstorage.app://auth/callback`, which is how Android declares what
  `CFBundleURLTypes` declares on iOS. Without it Google sign-in leaves and never
  comes back. Everything else carried over untouched — `apiUrl()` had already
  solved the relative-`/api` problem for both shells, which is the payoff of
  having solved it properly once.


- **The four Capacitor plugins that had been sitting in `package.json` unused
  since v1 now do something.** They were worse than absent: they read as native
  support that did not exist, and they left the shell indistinguishable from the
  website it wraps — which is what App Store guideline 4.2 turns down.

  `Share` puts a link into the system sheet, where a person expects it to go,
  instead of a clipboard they then have to paste somewhere; the clipboard stays
  as the fallback for any device that reports no sheet. `Keyboard` sizes the
  body rather than the whole WebView, so a focused field no longer takes the
  header off the top of the screen. `Haptics` answers the one tap in the app
  that starts something irreversible. `StatusBar` follows the theme, and follows
  it again when the OS changes it while the app is open.

  Everything is behind one `Capacitor.isNativePlatform()` check rather than
  behind caught errors — a caught error is indistinguishable from a plugin that
  is genuinely broken.

### Fixed

- **The sign-in gradient stopped short of the top edge on a phone.** It was
  painted on a `div` inside `ion-content`, and the safe-area inset lands on the
  scroll container — so the child began below it and a strip of the page's own
  background showed above. It is now `ion-content`'s own `--background`, which
  covers the inset too. Free on the web, where the inset is zero.

- **`StatusBar.setOverlaysWebView` was being called on Android, where it does
  nothing.** It is implemented with the `SYSTEM_UI_FLAG_*` constants, which
  stopped having an effect at API 35; the call is gone rather than left reading
  as though it worked. What actually decides edge-to-edge there is Capacitor's
  own `SystemBars`: given `viewport-fit=cover` in the viewport meta — this app
  has it — and a WebView at or past version 140, it hands the insets to CSS.
  Below 140 it insets the WebView on purpose, working around a Chromium
  safe-area bug. That is what the band across the top of
  `docs/screenshots/android-login.png` is: the Android 15 emulator image ships
  WebView 124. Nothing in the app can override it, and nothing should try.

- **A black band across the top of every screen on iOS**, found by running the
  build rather than by reading it. `StatusBar.setOverlaysWebView(false)` is the
  reflex carried over from Android; on iOS it insets the WebView and fills the
  gap with the window background, so the login gradient ended under a black
  stripe with no clock in it. The call is gone. Ionic already derives
  `--ion-safe-area-top` from `env(safe-area-inset-top)` and every `ion-header`
  pads itself by it, which is the mechanism that was being replaced by a worse
  one.

  The login page then needed the other half: it is a deep indigo gradient in
  both themes, so following `body.dark` put dark glyphs on a dark ground in the
  light theme and the clock vanished. It now asks for light glyphs on entry and
  restores the theme's own choice on the way out.

### Changed

- **The native build no longer offers a way to buy anything.** App Store
  guideline 3.1.1 requires digital content consumed inside an app to be sold
  through In-App Purchase, and Pro storage is that; the rule also covers buttons
  and links steering the user to buy it elsewhere, so redirecting the plans page
  would not have satisfied it. All three routes into billing — the plans page,
  the dashboard header button that is its only permanent entry, and the banner
  at 80% of quota — now ask one predicate, `billingIsOffered()`, which is false
  in a Capacitor shell whatever `VITE_BILLING_ENABLED` says.

  A runtime check rather than a second build, for the reason `apiUrl()` is one:
  a single `npm run build` makes both bundles, and a second configuration is a
  second thing to keep in step — one whose first symptom, out of step, is a
  rejection weeks later.

  The cost is stated rather than hidden: someone who fills 500 MB in the app
  cannot buy more from inside it. They can on the web, with the same account.
  [ADR 0012](docs/decisions/0012-the-native-build-sells-nothing.md) has the
  reasoning, including why In-App Purchase is deferred and not refused.

- **There is one deployment of this app again.** A second Vercel project,
  `cloud-storage-app-ionic`, had been serving a build from before v3.0.0 at a
  hostname four characters from the real one — publicly, answering 200, with one
  of the seven security headers the live deployment sets and no CSP at all. It
  had not deployed in 102 days while the repository took 40 commits, so it was
  no longer connected to anything; it simply kept answering.

  It also held five environment variables, one of them a Cloudinary API secret
  that had sat on an unwatched project for 254 days. **That secret should be
  rotated regardless** — deleting the project removes the surface, not the
  history.

  Deleting it touched nothing: the live app is a different project, no custom
  domain in the account pointed at the old one, and nothing in this repository
  ever linked to it. `cloud-storage-app-ionic.vercel.app` now answers 404, and
  the live deployment still answers 200 with all seven headers.

- **The end-to-end suite stopped writing to the production database.** The four
  Supabase secrets in GitHub Actions had pointed at the project the app serves
  since they were set in August, so every push minted real users next to real
  ones, and a run that died before its `afterAll` left them there. They now
  point at `cloudstorage-ci`, a second free-tier project that exists for nothing
  else.

  It is the same schema by construction — `migrations/` applied in order, 000
  through 008 — and by check: columns, indexes, triggers and RLS policies were
  diffed against production and came back identical, 40 columns, 16 indexes, 2
  triggers and 4 policies on each side. That is worth more than the isolation it
  buys, because it is the first evidence that `migrations/` describes the whole
  database rather than most of it — and the `early_access` table dropped in this
  same release was the standing proof that it had not.

  The full suite passes against it: 41 tests, three projects, 1.2 minutes.

### Removed

- **Two production dependencies that nothing imports.** `@sentry/tracing` has
  zero occurrences outside `package.json` — it was superseded by `@sentry/react`
  (already installed, and what `src/observability/` actually uses) and abandoned
  upstream two majors ago.

  `esbuild` was pinned into `dependencies` in February to fix a Vercel build,
  and it fixed the wrong thing: the break came from a hand-pinned
  `@esbuild/darwin-arm64` — a macOS-only binary in a Linux build — and the
  remedy was to stop declaring the binary, not to declare the compiler. Nothing
  in `src/`, `api/` or `lib/` imports it, and Vite never used the root copy
  anyway: it resolves its own nested `esbuild@0.21.5`, while tsx and Vitest
  bring theirs. Each of them installs the right platform binary through
  `optionalDependencies`, which is the mechanism the pin had been substituting
  for.

  The audit is the measurable part: production dependencies go from 106 to 100,
  and the one `low` advisory — a development-server file read, in a compiler
  that never reached production — leaves the production report entirely. It
  reads **0 critical, 0 high, 2 moderate, 0 low**; the two moderates are
  `react-router`, which needs the v7 migration and is named in the README.

  It also settles Dependabot #39, which had been held open since August because
  the policy in [ADR 0006](docs/decisions/0006-dependabot-skips-majors.md) calls
  `0.27 → 0.28` a major. There is no longer a direct dependency to bump.

- **The `early_access` table, which existed in production and nowhere else.** A
  Pro-plan waitlist — email, status, notes — created by hand in the dashboard
  for a feature that was never built; billing shipped in v3.0.0 as Stripe
  Checkout with no waitlist in front of it. It held 0 rows, had 0 references in
  `src/`, `api/`, `lib/` or `e2e/`, and 0 lines in `migrations/`.

  It was also accepting an anonymous `INSERT`, and the policies said so outright
  rather than only the 201 an audit had got out of PostgREST on 2026-09-04:
  **two** identical `FOR INSERT TO public WITH CHECK (true)` policies, alongside
  **two** identical `SELECT` policies gating reads on a personal address written
  into the policy body. Duplicated because the table was created by hand, twice,
  in the dashboard. Unauthenticated writes into a table nobody reads is the shape
  a spam sink takes, and nothing would ever have noticed.

  A pair of RLS policies would have closed that and left a table in the schema
  that no code opens. `migrations/008_drop_early_access.sql` drops it instead,
  and carries the description of what it was — which a `DROP` typed into the
  dashboard would not have left behind. Applied to production on 2026-09-05: the
  table and all four policies are gone, PostgREST answers `PGRST205` for it, and
  the five tables the app actually uses are untouched.

## [4.2.0] — 2026-09-05

### Changed

- **React 19 and Ionic 9**, taken together because Ionic 9 is the release that
  supports React 19, and taken by hand under
  [ADR 0011](docs/decisions/0011-majors-are-taken-by-hand.md). Not one line of
  application code had to change: types, lint, 621 unit tests and 41 e2e are
  green on the upgraded tree, and the unit suite runs in the same six and a half
  seconds it did before.

  One selector had to change: Ionic 9 sets component props as properties rather
  than attributes, so `ion-input[type="email"]` now matches nothing while
  `host.type` is still `'email'`. Attributes the DOM itself reflects — `slot`,
  `aria-*`, `title` — are unaffected, which is why nothing else in the suite or
  the stylesheets moved.

  It cost **22.4 kB gzip** on the first load — react-dom 19 is 18.4 of it and
  Ionic 9's move onto `@lit/react` the remaining 6.9 — so the bundle budgets go
  from 420/250/520 kB to 445/260/540. Raised once, deliberately, with the figure
  written down: the check earned its keep by putting that number in front of
  someone at the moment they could still decide whether to pay it.

### Fixed

- **The unit suite was testing Ionic's server build.** Ionic 9 builds its React
  components on `@lit/react`, which ships two copies — a browser one that
  attaches properties and event listeners in `useLayoutEffect`, and a node one
  for server rendering that attaches nothing at all. Vitest runs in node even
  under a jsdom environment, so it resolved the second, and every Ionic control
  rendered as markup that answered no events: four searchbar tests failed while
  the same interaction passed in the e2e suite, which drives a real browser.

  The jsdom project now resolves the `browser` condition — on `ssr.resolve` as
  well as `resolve`, because Vitest transforms modules through Vite's SSR
  pipeline and that has a condition list of its own.

- **The login page no longer scrolls on a laptop.** The card is 799px tall and
  a MacBook with a bookmarks bar showing gives it 720, so the wordmark went off
  the top and a scrollbar appeared — the demo entry, 78px of it, was what
  finally pushed it over. Spacing is trimmed below 820px of viewport height and
  left alone above it: a login form that is merely compact still reads as
  designed, one that scrolls reads as broken. An e2e test now measures the page
  at 1440×720, because every element on it was added one at a time and none of
  them was the one that broke it.

- **The dependency audit no longer fails the build because npmjs.com was
  down.** `npm audit --audit-level=high` exits 1 when it finds a vulnerability
  and exits 1 when the audit endpoint answers 503 — which it did twice in one
  day, both times on a required check. A check that turns red on someone else's
  uptime gets re-run without being read, and a check nobody reads is the same as
  no check. It now asks for JSON and tells the two apart: a report is acted on,
  an unreachable registry is retried three times and then reported as
  not-checked, because "could not check" is not "vulnerable". The moderate and
  low counts, which the old command swallowed, are printed either way.

## [4.1.0] — 2026-09-04

### Added

- **An iOS app, built and run rather than promised.** The README had offered
  iOS and Android in three places since v1 and no repository had ever contained
  either project. `ios/` now exists, and the app launches on an iPhone 17
  simulator under iOS 26.5. Capacitor went from 6.2.1 to 8.5.1 to get there —
  the 2024 template predates Xcode 16's script sandboxing — which also moved
  plugin distribution from CocoaPods to Swift Package Manager.
- **`VITE_API_ORIGIN`, and an `apiUrl()` that knows when to use it.** Eleven
  calls named their route with a path — right in a browser, where the page and
  the functions share a deployment, and a 404 in a Capacitor WebView, which
  serves the page from `capacitor://localhost` and resolves that path against a
  local file server. The demo account, the Cloudinary signature, all of R2 and
  with it resumable uploads, Stripe, share links and Dropbox were every one of
  them broken in the shell. The web build is unchanged: the origin is applied
  only when `Capacitor.isNativePlatform()` says so, so a preview deployment
  still calls its own copy. See [ADR 0010](docs/decisions/0010-the-native-shell-has-its-own-origin.md).
- **CORS for the two shell origins**, `capacitor://localhost` and
  `http://localhost`, by name rather than by `*` — these routes read bearer
  tokens and open Stripe sessions. The preflight is answered before the code
  that expects an `Authorization` header, since a preflight never carries one.
- **Sign in with Google on a device**, through the system browser and back
  through `com.cloudstorage.app://auth/callback`. `redirectTo` was
  `window.location.origin + '/dashboard'`, which on a device is an address
  neither Google nor Supabase will accept — and Google refuses to sign anyone
  in inside an embedded WebView regardless. Needs the callback listed in
  Supabase's URL configuration to work end to end.
- **A smoke test that opens the built bundle in a browser** (`npm run smoke`),
  in CI beside the bundle-size check. See below for what it was written for.

- **Accessibility is now asserted on the rendered DOM**, at WCAG 2.1 A and AA,
  by `@axe-core/playwright` — the login page, the dashboard with folders and
  files on it, the upload page with a queue, the file view and the plans page.
  `eslint-plugin-jsx-a11y` reads the source and Lighthouse audits the built
  shell, which behind a login form is an empty page and two static documents;
  everything the app actually is had been checked by neither.
- **A Playwright project at phone size** (Pixel 7), carrying the checks whose
  subject is the phone: that nothing scrolls sideways, that the primary action
  answers a tap and not only a mouse, and that the layout at that width is as
  accessible as the wide one. Its own project rather than a second pass of the
  whole suite, which would double the run to repeat assertions the desktop
  project already makes.

### Fixed

- **A blank page from the production build**, in the browser and in the app
  alike. `manualChunks` put `react-dom` and the router in a `react` chunk and
  left React itself to fall through to `vendor`; that only works while Rollup
  happens to evaluate `vendor` first, and adding a dependency was enough to
  reverse it. react-dom then read `__SECRET_INTERNALS_…` off an uninitialised
  binding and rendered nothing.

  Worth the entry for how it hid rather than for the fix, which is one regular
  expression. Lint, 621 unit tests, the whole Playwright suite and the bundle
  budgets were green on a build that painted nothing: `npm run dev` serves
  unbundled modules, so the chunk split is inert there, and the e2e suite runs
  against that dev server. No check in this repository had ever executed the
  file the browser downloads. One does now.

- **A delete button nested inside the button that opens the file.** Each row was
  a `div` with `role="button"` wrapped around an `ion-item`, which broke three
  things at once: a list whose children were not list items, a list item with no
  list above it, and one control inside another — undefined for a screen reader,
  and unreachable by keyboard in the order the layout implies. The row is now
  the list item, and the two actions are siblings: a button stretched over the
  row to open it, and delete beside it. The folder cards had the same shape and
  the same fix.
- **Thirty-five icons announced as unlabelled images.** `ion-icon` renders with
  `role="img"`, so every decorative one was an image with no alternative text.
  They carry `aria-hidden` now.
- **Six buttons with no accessible name**, all icon-only: sign out, the plans
  link, up-one-folder, delete on a file row, and the three back buttons on the
  file page. They had `title`, which is a tooltip for a mouse and not a name for
  the native button inside Ionic's shadow DOM.
- **Progress bars and spinners with nothing to announce.** A spinner that
  replaces a button's label leaves the button nameless while it works.

### Changed

- **The dependency policy has a second half**, written down in
  [ADR 0011](docs/decisions/0011-majors-are-taken-by-hand.md): Dependabot skips
  majors, and majors are taken by hand, one family at a time, with the test
  suite as the evidence. Capacitor 6 → 8 was the first one under it.

## [4.0.0] — 2026-09-04

### Added

- **A demo account, without signing up.** "Just looking? Open a demo account" at
  the foot of the login page mints a private account seeded with a few files and
  sweeps it after 24 hours. It is a real account — same RLS, same quota, same
  Stripe test-mode checkout — because a demo on a different code path stops
  proving anything.
- **A way to find a file.** A search box, six orderings and a filter by type,
  every one of which changes the query rather than the page already on screen —
  the dashboard loads fifteen rows at a time, so a filter applied in the browser
  would search whatever happened to be loaded. Search terms are escaped for
  `ilike`: `%` and `_` are wildcards, so looking for `report_final.pdf` also
  found `reportXfinal.pdf`, and looking for `50%` found everything.
- **Folders that can be walked.** `folders.parent_id` has been in the schema
  since migration `000` and nothing in the interface used it: there was one back
  arrow, and from two levels down it went to the root rather than to the folder
  above. There is now a breadcrumb path, real nesting, and rename and delete on
  a folder — `deleteFolder` had been sitting in the service without a button.
- **Several files at once, by picker or by drop.** The upload page queues a
  selection and works through it a file at a time, with progress per file, and a
  failure stops that file rather than the queue. The same file picked twice is
  skipped: identity is name, size and last-modified date, because the picker
  hands back a new `File` object every time and uploading the same bytes twice
  costs the quota twice. The queue's state lives outside React, which is what
  makes those rules testable without mounting anything.
- **Changes made offline are kept.** The app was half a PWA: the service worker
  served the shell and the last listing, so someone offline could look at their
  files and do nothing to them — a rename on a train failed with a network error
  and lost the new name. Renaming and deleting a file or a folder now goes to
  IndexedDB, shows on screen at once, and is sent when the connection returns.
  The queue is coalesced first (three renames of one file are one rename; a
  rename followed by a delete is only the delete), retried three times, and what
  it finally gives up on is reported rather than quietly dropped. Uploads and
  folder creation are deliberately not queued — the bytes are solved by
  resumable uploads, and a folder's id comes from the database, so anything
  queued against one created offline would have nothing to point at. The
  TanStack cache is not edited either: the queue is applied over it at render,
  so the cache stays a truthful snapshot of the server and the queue stays the
  record of what has not reached it.
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
  folder scoping and navigation, search, a multi-file upload, the offline queue
  and the demo entry point. Every test gets its own account from a fixture
  rather than sharing one, which is also what let the CI run go back to four
  workers.
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
- The dashboard's title bar said "Folder" at the root, where there is no folder
  to name. It says "My Files" — visible on every phone-width header and in the
  README's own hero screenshot.

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

[unreleased]: https://github.com/Alexandr-Paleev/CloudStorageApp-Ionic/compare/v4.3.0...HEAD
[4.3.0]: https://github.com/Alexandr-Paleev/CloudStorageApp-Ionic/compare/v4.2.0...v4.3.0
[4.2.0]: https://github.com/Alexandr-Paleev/CloudStorageApp-Ionic/compare/v4.1.0...v4.2.0
[4.1.0]: https://github.com/Alexandr-Paleev/CloudStorageApp-Ionic/compare/v4.0.0...v4.1.0
[4.0.0]: https://github.com/Alexandr-Paleev/CloudStorageApp-Ionic/compare/v3.1.0...v4.0.0
[3.1.0]: https://github.com/Alexandr-Paleev/CloudStorageApp-Ionic/compare/v3.0.0...v3.1.0
[3.0.0]: https://github.com/Alexandr-Paleev/CloudStorageApp-Ionic/compare/v2.1.0...v3.0.0
[2.1.0]: https://github.com/Alexandr-Paleev/CloudStorageApp-Ionic/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/Alexandr-Paleev/CloudStorageApp-Ionic/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/Alexandr-Paleev/CloudStorageApp-Ionic/releases/tag/v1.0.0
