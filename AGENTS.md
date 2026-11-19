# AGENTS.md — CloudStorageApp-Ionic

## Rules for agents (read first)

They hold for every agent working here (Claude Code, Codex). The owner's personal preferences live outside the repository.

- **Git is the owner's.** Edit files and stop there: no commit, push, merge, tag, switch, rebase, stash or reset, and no `gh pr create/edit/merge/comment` or `gh release create`. Hand over one block of commands per PR, only the one that can run now: `git switch main && git pull --ff-only`, the branch, the commit, the push, `gh pr create --body-file <file>`. No `Co-Authored-By` trailers. Run `npm ci` as `HUSKY=0 npm ci`: its `prepare` script otherwise writes git config.
- **When to ask.** Do not narrow a task with a question: cover the variants and say where they differ. Ask only when the options exclude each other and the wrong one would make the work useless. Before the first edit, say in a sentence or two what you will do and what it costs: an announcement the owner can cancel, not a question, and as strict as the change is hard to undo. Wait for an explicit yes before anything that changes the production database, deletes data, deploys or writes to an outside service (Stripe, Supabase, Vercel).
- **Change only what the task needs.** No drive-by refactors, renames, reformatting or new dependencies (a new one needs a yes; `npm run size` holds the budgets). Remove what your change left unused. Comments must stay true: fix the ones your change makes wrong, leave the rest.
- **Do not touch unless asked:** an applied migration (write the next number instead); `ios/` and `android/` beyond what `npx cap` writes; `.env*`; `package-lock.json` by hand; `apps/web/content/*.md`; released sections of `CHANGELOG.md`. Never print a secret's value, only its name.
- **Done means checked.** Before saying done: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`; the site's own scripts for a change under `apps/web`; `uv run pytest` in `evals/` for a change there; `npm run test:e2e`, `npm run size` and `npm run smoke` when the change can move them; `gitleaks dir` over the changed files. A fix comes with a test that fails on `main` without it. Quote failures; never write "works" without the output that shows it.
- **CI decides the merge:** `check`, `e2e` and `evals` in `ci.yml`, `codeql` and `gitleaks` in `security.yml`. A CodeQL comment blocks it; the usual causes here are removing tags with a regex (parse through the DOM) and a host regex without anchors (compare `URL.hostname`). gitleaks scans the branch's whole history: a random-looking literal next to the word token or key, even in a test, fails it, and only rewriting that commit clears it.

## Project overview

Freemium SaaS Cloud Storage App built with Ionic + React + TypeScript. The current
version is whatever `package.json` says — it moves most days, so it is not repeated here.
Multi-provider file storage: Supabase Storage, Cloudinary, Cloudflare R2, Google Drive, Dropbox (Pro).
Stripe billing with Free (500MB) and Pro ($9/mo, 5GB) tiers. Deployed on Vercel as a PWA.

## Tech stack

- **Framework:** Ionic React 9 + React 19 + TypeScript 5.9
- **Auth & DB:** Supabase (auth + Postgres)
- **Storage providers:** Supabase Storage, Cloudinary, Cloudflare R2, Google Drive, Dropbox (Pro)
- **Billing:** Stripe (subscriptions, Checkout, Customer Portal)
- **State management:** TanStack Query v5
- **Build:** Vite 8 (Rolldown) + vite-plugin-pwa
- **Analytics:** Google Analytics 4 (react-ga4) + Hotjar
- **Error tracking:** Sentry
- **Deployment:** Vercel (with serverless functions in /api)
- **Mobile:** Capacitor 8 — `ios/` and `android/` are both in the repo; iOS runs on an iPhone 17 simulator (iOS 26.5), Android on a Pixel 7 emulator (Android 15)

## Commands

- `npm run dev` — start dev server
- `npm run build` — type-check (tsconfig.build.json + tsconfig.api.json) + vite build
- `npm run lint` — ESLint 9, flat config in `eslint.config.mjs`; covers the app, `api/` and `libs/`, not `apps/`
- `npm run <dev|build|lint|test|smoke> --workspace @cloud-storage/web` — the public site in `apps/web` (Next.js 16)
- `npm run typecheck` — types for the tests and e2e, which `npm run build` does not read
- `npm run format` — Prettier (2 spaces, src/**/*.{ts,tsx,json,css,scss})
- `npm test` / `npm run test:coverage` — Vitest (the app's two projects, node and jsdom; the site's third, `site`, runs from its own `npm test`)
- `npm run test:e2e` — Playwright (projects: chromium, mobile, chromium-r2)
- `npm run size` — bundle budgets; `npm run smoke` — the built bundle actually boots
- `npm run audit:prod` — production-dependency audit that survives a registry outage

## Project structure

```
src/
├── analytics/       # Hotjar init
├── components/      # Shared components (PrivateRoute, PageViewTracker, UpgradeBanner, ProviderSelector)
├── contexts/        # React contexts
├── hooks/           # Custom hooks (useAnalytics for GA4, useProfile for billing)
├── native/          # Capacitor-only code (deep links for OAuth in the shell)
├── observability/   # Sentry bootstrap (loads when idle)
├── pages/           # Route pages (Dashboard, Login, Upload, FileView, Pricing, SubscriptionSuccess, DropboxCallback)
├── providers/       # Storage provider abstraction layer
│   └── impl/        # CloudinaryProvider, R2Provider, GoogleDriveProvider, SupabaseStorageProvider, DropboxProvider
├── schemas/         # Zod schemas (file metadata)
├── services/        # API service layers (auth, billing, cloudinary, dropbox, googledrive, r2)
├── supabase/        # Supabase client config
├── theme/           # CSS variables and global styles
├── types/           # TypeScript type definitions (billing.types.ts)
├── utils/           # Utilities (retry, thumbnail, apiUrl for the native origin)
└── env.ts           # Environment variables (Zod-validated)

apps/web/            # The public site: Next.js (App Router), an npm workspace, its own
                     # Vercel project and origin. Holds no secrets. See ADR 0014

libs/                # Shared code, unit-tested next to the source — see ADR 0014
├── core/src/        # What more than one side uses (tiers, plans, format, multipart,
│                    # safe-url, ai, stored-path). A module joins when a second side needs it
├── server/src/      # What only api/ may use (auth, cors, quota, share, rate-limit,
│                    # account-erase, erase-providers and the rest)
└── boundaries.test.ts  # Holds the lint rule between the projects to its job

api/                 # Vercel serverless functions
├── account/         # delete.ts — erases the caller's account and everything under it
├── ai/              # [action].ts — index a file and embed a search query, in one function
├── cloudinary/      # [action].ts — sign and delete in one function
├── demo/            # session.ts — opens a demo account; sweeps expired ones on the way
├── dropbox/         # callback, token, disconnect (code is complete, no app configured)
├── r2/              # [action].ts — presign, multipart and delete in one function
├── stripe/          # create-checkout, create-portal, webhook
└── share.ts         # create, open and revoke share links
                     # 12 of Vercel's 12 Hobby functions are used: a new route has to
                     # join an existing one as an action — see ADR 0008

e2e/                 # Playwright specs, one account per test (fixtures.ts)
migrations/          # Numbered SQL, applied in order
docs/decisions/      # ADRs — read these before changing a decision they cover
```

## Key patterns

- **Storage provider pattern:** Abstract `StorageProvider` interface in `providers/storage.provider.ts`, concrete implementations in `providers/impl/`. Routes images to Cloudinary, files to R2/Supabase. Pro users can manually select a provider via `preferredProvider`.
- **Billing:** Stripe Checkout for upgrades, Customer Portal for management. Webhook updates `profiles` table. `useProfile()` hook provides tier/limits to components. Dynamic storage limits replace hardcoded `MAX_USER_STORAGE_LIMIT`.
- **Environment config:** All env vars validated via Zod in `src/env.ts`. Analytics vars (GA4, Hotjar) are optional.
- **Error handling:** Global query error handler in `main.tsx` tracks API errors to GA4. Sentry for crash reporting.
- **Analytics safety:** All GA4 calls wrapped in `safeAnalyticsCall()` to prevent ad-blocker crashes. GA4 only initializes in production.
- **Pre-commit:** Husky + lint-staged runs ESLint --fix and Prettier on staged .ts/.tsx files.
- **The native shell has its own origin:** a Capacitor WebView serves the page from `capacitor://localhost`, so every call to a function goes through `apiUrl()` (`src/utils/api.utils.ts`) and `VITE_API_ORIGIN` rather than a bare `/api/...` path. See ADR 0010.
- **Five Nx projects, kept apart by lint:** the app (root), the site (`apps/web`), `api/`, `libs/core`, `libs/server`. `src/` and `apps/web` import core by name (`@cloud-storage/core/<module>`, from `tsconfig.base.json`) and must not import `libs/server` at all. `api/` and `libs/server` import the libraries by **relative path, never by name**: Vercel's builder builds a named import without an error and the function then fails to load. `eslint.config.mjs` draws the Nx graph itself, because the boundary rule silently checks nothing without one.
- **CI has two pipelines in one job:** `scripts/ci-affected.mjs` sets `AFFECTED_APP` and `AFFECTED_WEB`. A change under `apps/web` must not run the app's e2e (30 accounts in the live database). The root project's Nx inputs name `api/` and `libs/` explicitly: `{workspaceRoot}/**/*` would mark it touched by every file, and a negative pattern does not undo that.
- **The site has its own `apps/web/vercel.json`, and needs it:** without one, Vercel built the site with the root `vercel.json`, which is the app's (`framework: vite`, `outputDirectory: dist`), and the first deployment failed after a successful `next build`. Anything about how the site is built on Vercel goes in that file, not in the dashboard.
- **The functions run in `fra1`, beside the database:** both `vercel.json` files say `"regions": ["fra1"]` (a Hobby project may choose one region). The database is in Supabase's `eu-central-1`, Frankfurt; from Vercel's default `iad1` each query cost about 290 ms, from `fra1` about 66 ms (measured 30.10.2026, #236). A fork with its database elsewhere moves the region with it.
- **The site must build when installed alone:** Vercel runs `npm install` inside `apps/web`, which installs that workspace only. Anything the site's build needs goes in `apps/web/package.json`, TypeScript included (Next installs the newest one if it finds none).
- **The terms and the privacy policy are pages of the site:** the only copy is `apps/web/content/*.md`, read by `apps/web/lib/markdown.ts`; a test fails on markdown that reader does not know. The app links to `SITE_ORIGIN` (`libs/core/src/origins.ts`), its `/terms` and `/privacy` forward, and `vercel.json` redirects six old addresses there, which `libs/core/src/origins.test.ts` holds to the constant. If the site's domain changes: that constant and those redirects.
- **The site's test files are excluded from `apps/web/tsconfig.json`:** `next build` must not need Vitest. They are type-checked by the root `npm run typecheck`, which CI runs for a site change too.
- **A share link's address is the site's, and nothing asks a request for it:** `shareLinkUrl` in `libs/core/src/share-link.ts`. `/api/share` issues links there; the app has no page for a link. A link at the app's old address, `/s/<token>`, is sent on by a redirect in `vercel.json` and, under the service worker, by the first lines of `src/main.tsx` — before analytics start, because GA4, Hotjar and Sentry are told the page's address and at that address the address is the token. Do not turn that forward into a route or a page. It can go a year after 5в shipped (no link lives longer than 365 days).
- **No collector is told an address that carries a secret (ADR 0015):** Google Analytics and Hotjar read the address themselves, so `src/analytics/collectors.ts` starts them only when the address has no query string and no fragment (asked again on every route change and on `hashchange`); `PageViewTracker` and the Hotjar hook report `pathname` only. Sentry starts at any address and `src/observability/scrub.ts` cuts every address in an event at `?` and `#`, and a stored file's name out of every address and path (what follows the owner's id, so a new provider lays its objects out under `ownerPrefix` or Sentry gets the names). A new route must not keep a secret in its query string, and a return address (Stripe, OAuth) carries only what the app reads. `npm run smoke` asks the built bundle with made-up tokens; CI's build has no collectors, so there only the unit tests hold it.
- **A stored address is handed out only if it is its provider's (`libs/server/src/stored-url.ts`):** `files.download_url` is the browser's writing, and the constraint on it asks only for http(s). `/api/share` reads the provider from the row as it stands when the link is opened (the owner can rewrite the row after sharing it): Cloudinary's host and the owner's folder, `www.dropbox.com`, `drive.google.com`. R2 and Supabase Storage are signed from the path and their stored address is never used. Anything else is refused. A new provider that stores a delivery URL needs its host there, or its files cannot be shared.
- **The share page is the one page of the site rendered on demand:** `apps/web/app/s/[token]`. Its server side asks `/api/share?…&describe` and keeps the answer for a strict minute in memory (`apps/web/lib/share.ts`), never in Next's `fetch` cache: that one keeps a 200 until a newer 200 replaces it, and a revoked link answers 410. The address of the file is asked for from the browser (`apps/web/lib/open-share.ts`); nothing rendered on a server may hold one. No `loading.tsx` beside the page: it would turn the 404 for a missing link into a 200.
- **The site's smoke test builds the site itself, against a stand-in for `/api/share`:** the real one answers a browser on the production site's origin only. `npm run smoke --workspace @cloud-storage/web` builds with `NEXT_PUBLIC_APP_ORIGIN` pointing at `apps/web/scripts/stub-api.mjs` and leaves that build in `.next`. The stand-in is a copy of what `api/share.ts` answers: a change to one is a change to the other.
- **`apps/web/next.config.ts` cannot import `@cloud-storage/core`:** Next resolves a tsconfig's `baseUrl` against `apps/web`, and ours is in `tsconfig.base.json`. The app's address is written there a second time, and `apps/web/next.config.test.ts` holds it to `libs/core/src/origins.ts`.
- **Majors are taken by hand:** `dependabot.yml` ignores them; they arrive on their own branch with before/after measurements. See ADR 0011.
- **CSP lives only in production:** the headers in `vercel.json` are sent by Vercel alone; `npm run dev`, which the e2e run on, sends none, and `libs/server/src/csp.test.ts` checks only what it lists. A new frame, script or font source is checked in Chrome against a build served with those headers, or it breaks first in production (4.0.0–4.7.2 blocked the PDF preview of files on Supabase, R2 and Cloudinary).
- **New tables get no grants by themselves (Supabase, since 30.10.2026):** a migration that creates a table in `public` grants each role what it needs in the same file, `service_role` included (see `016_grant_tables_to_service_role.sql`).
- **`anon` holds nothing (`012_revoke_inherited_grants.sql`):** whatever runs without a session uses the service-role key on a server, in a function or in a workflow. Before taking any further grant away, list the consumers that run without a session (`keepalive.yml` broke on exactly this).
- **Android's origin is `https://localhost`** (`androidScheme: 'https'`), iOS's is `capacitor://localhost`; both are in `libs/server/src/cors.ts`. A test of that list proves nothing unless it matches what the device sends.

## Style conventions

- 2-space indentation (enforced by Prettier via @ionic/prettier-config)
- CSS uses lowercase hex colors (e.g. `#4f46e5`)
- Commits follow conventional commits: `feat:`, `fix:`, `chore:`, `style:`, `refactor:`

## Important notes

- `.env` is gitignored — must be set up manually with Supabase, Cloudinary, R2 keys
- Vercel env vars must use `VITE_` prefix for client-side access
- Server-only Vercel env vars (no VITE_ prefix): STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID_PRO_MONTHLY, SUPABASE_SERVICE_ROLE_KEY
- Stripe webhook endpoint: `/api/stripe/webhook` — configure in Stripe Dashboard
- Supabase `profiles` table must exist — run `migrations/001_add_profiles_and_billing.sql`
- Supabase project can pause after inactivity — restore from dashboard if login fails with DNS error
- Releases are cut by hand: close `[Unreleased]` in CHANGELOG.md, bump package.json, tag, publish. Work that ships without this is invisible to anyone reading the repo.
