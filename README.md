# ☁️ Cloud Storage App

[![CI](https://github.com/Alexandr-Paleev/CloudStorageApp-Ionic/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Alexandr-Paleev/CloudStorageApp-Ionic/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Alexandr-Paleev/CloudStorageApp-Ionic?sort=semver)](https://github.com/Alexandr-Paleev/CloudStorageApp-Ionic/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Demo](https://img.shields.io/badge/Demo-Live-success)](https://cloud-storage-app-ionic-v0.vercel.app)
[![Coverage — server](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FAlexandr-Paleev%2FCloudStorageApp-Ionic%2Fbadges%2Fcoverage-server.json)](#what-the-tests-cover-and-what-they-deliberately-do-not)
[![Coverage — client](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FAlexandr-Paleev%2FCloudStorageApp-Ionic%2Fbadges%2Fcoverage-client.json)](#what-the-tests-cover-and-what-they-deliberately-do-not)

<p align="center">
  <img src="docs/screenshots/three-platforms.png" alt="The same app running in three places at once: the web build in a browser at the production URL, a Pixel 7 Android emulator and an iPhone 17 simulator, both showing the sign-in card" width="820"><br>
  <sub>One <code>npm run build</code>, three shells — the browser, a Pixel 7 emulator and an iPhone 17 simulator</sub>
</p>

An **open-source** cloud storage product: an app for storing, viewing, sharing and managing files, and the public site in front of it. The app is Ionic + React, an installable PWA that also builds for iOS and Android through Capacitor. The site is Next.js, on an origin of its own. They share one Nx workspace with the Vercel functions behind them, on Supabase, with Stripe billing, five storage backends, and search by meaning over pgvector.

🔗 **[Live Demo](https://cloud-storage-app-ionic-v0.vercel.app)** | 🌐 **[Site](https://cloud-storage-web-xi.vercel.app)** | 💎 **[Pro tier](#-pro-tier)** | 📦 **[Releases](https://github.com/Alexandr-Paleev/CloudStorageApp-Ionic/releases)** | 📓 **[Changelog](CHANGELOG.md)**

> ⚡ **No sign-up needed.** "Just looking? Open a demo account", at the foot of
> the login page, opens a private account seeded with a few files and deletes it
> after 24 hours. It is a real account — same row-level security, same quota,
> same Stripe test-mode checkout — because a demo running down a different code
> path stops proving anything.
>
> It sits at the foot of that page rather than the top on purpose. As the first
> element, styled like the submit button, it left two identical primary buttons
> on the card and pushed the real one below the fold — and the page read as a
> showcase rather than as a product.

> 💳 **The demo runs Stripe in test mode.** Real cards are declined — upgrade with `4242 4242 4242 4242`, any future expiry, any CVC. No money changes hands.

## 🔎 Engineering highlights

Three things in this repository worth more than the feature list, each written
up where it happened:

- **[An `anon` key deployed under the name `SUPABASE_SERVICE_ROLE_KEY`](#-postmortem-the-anon-key-that-was-named-supabase_service_role_key)** —
  for 221 days, across three environments, with every check green. It fails
  silently: RLS reduces every server-side query to zero rows, so handlers report
  missing data for rows that plainly exist. The lesson was to verify what a
  secret *is*, not what the variable is called — `assertServiceRoleKey` now
  refuses to start on the wrong one.
- **[Privilege escalation through a row-level security policy](docs/decisions/0002-billing-is-server-write-only.md)** —
  `profiles` shipped the obvious "users may update their own row" policy. RLS has
  no column-level granularity, so that included `tier`, and any user could grant
  themselves the paid plan from the browser with the published anon key.
- **[A storage quota enforced on one provider out of three, with a race on that one](docs/decisions/0004-quota-lives-in-the-database.md)** —
  images go straight from the browser to Cloudinary, so no server saw them and
  the limit rested on a check in the client. Even the guarded path was
  check-then-act: two parallel uploads both passed. It is now a trigger on the
  row every upload must reach, holding a lock while it counts.

Two more are not about a fault. They are about how something was built:

- **[The public pages are a second app, on an origin of its own](docs/decisions/0014-the-public-pages-are-a-second-app.md)** —
  a Next.js site beside the Ionic app, in one Nx workspace of five projects.
  Only the functions may import the library that holds the service-role
  client. Lint refuses anything else, and a test holds the rule to its job by
  reading the import graph, which a disable comment cannot edit. CI asks the
  workspace what a push touches, so a sentence changed on the site does not
  put the end-to-end suite through the live database.
- **[Search by meaning is indexed on demand, by a swappable model](docs/decisions/0013-search-by-meaning-is-indexed-on-demand.md)** —
  a model writes one sentence about a file, the sentence becomes a vector, and
  Postgres ranks by distance with pgvector, inside the caller's own rows and
  under RLS. Two model backends sit behind one seam, and a deployment that has
  not switched the mode on does not show it. The public demo is one of those.

Every decision of this kind has a short record in
**[`docs/decisions/`](docs/decisions/)** — context, decision, and the
consequences that cost something.

## 📋 Project Description

Cloud Storage App is a full-featured cloud file storage that allows users to:

- Securely store files in the cloud (PDFs, images, documents)
- View and manage files through a user-friendly interface
- Use the app in a browser, as an installable PWA, or as a native iOS or Android build
- Automatically expand storage via Google Drive when the limit is exceeded
- Upgrade to a paid tier for more space and additional providers

## 📸 Screenshots

<p align="center">
  <img src="docs/screenshots/dashboard.png" alt="Dashboard with the storage meter, the Pro badge, a search box, filters by type, folders and a list of files" width="820">
</p>

| Upload — several files at once, and Pro users pick the backend                                                                                                                              | Plans — Stripe in test mode                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| <img src="docs/screenshots/upload.png" alt="Upload screen with a provider picker: Auto, Cloudinary, Cloudflare R2, Supabase, Google Drive, Dropbox" width="420"> | <img src="docs/screenshots/pricing.png" alt="Free and Pro plans with a demo mode notice" width="420"> |

| File view                                                                                                 | What a share link opens                                                                                                            |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| <img src="docs/screenshots/file-view.png" alt="File view with preview, metadata and actions" width="420"> | <img src="docs/screenshots/shared-file.png" alt="Public share page showing the file name, size and a download button" width="420"> |

Share links are listed on the file they belong to, with their state and a way to revoke them:

<p align="center">
  <img src="docs/screenshots/share-links.png" alt="Share links panel showing an active link with its creation and expiry dates and a revoke button" width="820">
</p>

A change made with no network is written down rather than lost. The file is
already gone from the list — the queue is applied over the cached listing at
render — and the banner says the deletion has not reached the server yet:

<p align="center">
  <img src="docs/screenshots/offline-queue.png" alt="Dashboard offline: a banner reading one change waiting for the network with a Try now button, and the deleted file already absent from the list" width="820">
</p>

<p align="center">
  <img src="docs/screenshots/dashboard-mobile.png" alt="The dashboard on a phone-sized viewport" width="300"><br>
  <sub>The same dashboard as an installed PWA</sub>
</p>

## ✨ Key Features

### 🔐 Authentication

- ✅ Email/Password registration and login
- ✅ Google Account sign-in
- ✅ **One-click demo** — a throwaway account, seeded and signed in, no sign-up
- ✅ Protected routes (authorized users only)
- ✅ **Account deletion from inside the app**, at `/account`. Files, folders,
  share links, profile and login, in the order the missing foreign keys demand —
  bytes first, rows second, the user last

> **What account deletion does not reach.** Files the app placed in *your own*
> Google Drive or Dropbox stay where they are. They live in a storage account
> you control, put there under your own OAuth grant, and this app holds no
> standing authority to delete from either — the Dropbox refresh token is
> erased along with the row that held it. Everything the app stores on your
> behalf — Supabase Storage, Cloudflare R2, Cloudinary — goes.

### 📁 File Management

- ✅ Several files at once — picked or dropped onto the page — uploaded one after
  another, with progress per file and a failure that stops that file rather than the queue
- ✅ Search by name, six orderings and a filter by type. All three change the
  query, not the fifteen rows already on screen
- ✅ **Search by meaning**, for the files whose name is `IMG_4821.jpg`. A model
  writes one sentence about a file when you ask it to, the sentence becomes a
  vector, and Postgres ranks by distance with pgvector — inside your own rows,
  under RLS, from the browser. Indexing is a button rather than something an
  upload triggers, because every description is a paid request. Which models
  run depends on which keys the deployment has, and a deployment with none —
  every fresh clone — does not show the mode at all
  ([ADR 0013](docs/decisions/0013-search-by-meaning-is-indexed-on-demand.md))
- ✅ Nested folders with a breadcrumb path back to any level; folders can be renamed and deleted
- ✅ PDF and image preview
- ✅ File renaming and deletion — removed from the provider, not just from the list
- ✅ **Renames and deletions survive being offline.** The change is written to
  IndexedDB, applied to the screen immediately, and sent when the connection
  returns — coalesced, retried, and reported if it is finally refused
- ✅ Metadata display (size, upload date, type)

### 💾 Storage

- ✅ **500 MB** free per user, **5 GB** on Pro
- ✅ Five backends: Cloudinary, Supabase Storage, Cloudflare R2, Google Drive, Dropbox (Pro)
- ✅ Images routed to Cloudinary, other files to R2/Supabase — Pro users can pick a provider by hand
- ✅ Files over 16 MB go to R2 in parts, and can be paused and resumed — including after a reload
- ✅ Automatic Google Drive connection when the limit is exceeded
- ✅ Visual storage usage indicator, honest about accounts that are over the limit
- ✅ Quota is enforced in the database, on every path. A file exists in this app
  only once its row lands in `files`, whichever bucket holds the bytes, so a
  trigger there is what actually holds the line — including for uploads that go
  from the browser straight to a provider. `/api` refuses over-quota uploads
  before the bytes travel; the trigger is what makes that refusal binding.
  Google Drive and Dropbox are not counted: those files live in the user's own
  cloud, which is what makes overflowing into a connected Drive work at all.
- ⚠️ The size the trigger checks is the one written on the row, and the row is
  written by the browser. No path can skip the check, and no two uploads can
  claim the same free space — but a caller crafting the insert by hand can
  declare a smaller number than it uploaded. Closing that needs a size the
  server has verified, which needs the server to see the bytes, which is the
  4.5 MB request limit these direct uploads exist to avoid.

### 💳 Billing

- ✅ Free and Pro ($9/mo) tiers backed by Stripe
- ✅ Stripe Checkout for upgrades, Customer Portal for management
- ✅ Webhook keeps the tier in sync both ways — upgrade and cancellation
- ✅ Storage limits and allowed providers driven by the tier, not hardcoded

### 🔗 Sharing

- ✅ Public share links — send a file to someone without an account
- ✅ Links expire (7 days by default) and can be revoked from the file page
- ✅ Each file lists its links with their state: active, expired or revoked
- ✅ The recipient sees the file and nothing about its owner
- ✅ A link opens a page of the public site, rendered on a server: a messenger
  that unfurls the link shows the file's name, and the recipient does not
  download the app to read it

> **What revoking does, precisely.** It stops `/s/:token` from opening. It cannot
> withdraw a file someone already downloaded, and on providers that serve
> permanent public URLs (Cloudinary, Dropbox, Google Drive) the direct file
> address keeps working for anyone who opened it. R2 and Supabase Storage are
> signed per request and do expire. The UI says this rather than promising a
> clean revoke.

### 📱 Platforms

- ✅ **Web** — works in any modern browser
- ✅ **PWA** — installable on phone or computer. Offline it serves the shell and
  the last listing _and_ accepts renames and deletions, which wait in IndexedDB
  until the network comes back
- ✅ **iOS** — built with Capacitor 8 and run on an iPhone 17 simulator
  (iOS 26.5); `ios/` is in the repository
- ✅ **Android** — built with the same Capacitor 8 and run on a Pixel 7
  emulator (Android 15); `android/` is in the repository — see
  [Mobile app](#-mobile-app)

> 📱 **PWA Ready!** Install the app on your device: [Testing Guide](PWA_TESTING.md)

### 🎨 Interface

- ✅ Responsive design (works on all screen sizes)
- ✅ Modern UI based on Ionic components
- ✅ Dark/light theme, following the system setting
- ✅ Smooth animations and transitions

> **The dark theme was only half wired**, and it is worth writing down because
> nothing failed loudly. Nineteen rules across four stylesheets were written
> under `body.dark`, and no code ever added that class — so every one of them
> was dead. Meanwhile a `prefers-color-scheme` block set `--ion-text-color` to
> near-white on `:root`, which _did_ apply. An operating system set to dark
> therefore got near-white text on cards that stayed white: measured at
> **1.05:1** in the login form, meaning what you typed was invisible unless you
> selected it. `theme/dark-mode.ts` now syncs the class, which makes the
> existing CSS do what it always said it did, and the palette swaps `dark` and
> `light` the way Ionic's own dark theme does — `color="dark"` names a palette
> entry, not the text colour, so every `<IonText color="dark">` had gone
> near-black on a near-black card. Three more contrast failures found by
> measuring rather than looking are fixed alongside it.

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the project root:

```env
# Supabase Configuration
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

# Cloudinary Configuration
# The API key is deliberately absent: it belongs to the server-side block below,
# without the VITE_ prefix. Vite writes every VITE_ variable the app reads into
# the public bundle, so a prefix is a decision to publish. The app reads the
# ones named in src/env.ts, and no others reach the bundle.
VITE_CLOUDINARY_CLOUD_NAME=your_cloud_name

# Required: API endpoint for file deletion
VITE_CLOUDINARY_DELETE_API_URL=https://your-project.vercel.app/api/cloudinary/delete

# Optional: Google Drive (for extra storage)
VITE_GOOGLE_CLIENT_ID=your_google_client_id

# Optional: Analytics (production only)
VITE_GA4_MEASUREMENT_ID=G-XXXXXXXXXX
VITE_HOTJAR_SITE_ID=1234567
VITE_HOTJAR_VERSION=6

# Billing — off by default, so a deployment without Stripe keys never shows a
# buy button that would answer with a 500
VITE_BILLING_ENABLED=true
# Shows the "test card" notice on the plans page; set while on Stripe test keys
VITE_BILLING_DEMO_MODE=true

# One-click demo. Two variables on purpose: the VITE_ one only shows the button,
# and a route that creates accounts must not be reachable because a client flag
# was left on. /api/demo/session answers 404 unless DEMO_ENABLED is set too.
VITE_DEMO_ENABLED=true
DEMO_ENABLED=true

# Where the native shells find the API. Only the iOS and Android builds read
# it: a Capacitor WebView serves the page from capacitor://localhost, so a
# relative /api path resolves against a local file server and 404s. The web
# build ignores it and keeps calling its own deployment — see ADR 0010.
VITE_API_ORIGIN=https://your-project.vercel.app

# Optional: Dropbox (Pro tier provider)
VITE_DROPBOX_APP_KEY=your_dropbox_app_key
VITE_DROPBOX_REDIRECT_URI=https://your-project.vercel.app/dropbox/callback
# Server-side copy — the OAuth code is exchanged in /api/dropbox/*, never in
# the browser, so the key must also exist without the VITE_ prefix.
DROPBOX_APP_KEY=your_dropbox_app_key
```

> **Dropbox tokens are handled server-side.** The refresh token is stored in the
> `dropbox_connections` table (see `migrations/003_add_dropbox_connections.sql`)
> and never reaches the browser; the app holds only a short-lived access token,
> in memory. Run migration 003 before enabling Dropbox.

### 3. Service Setup

#### Supabase

1. Create a project on [Supabase.com](https://supabase.com/)
2. Run every file in `migrations/` in the SQL Editor, in numerical order:
   - `000` — `files` and `folders`, with their RLS policies
   - `001` — the `profiles` table billing depends on
   - `002` — closes a privilege-escalation hole in the profiles RLS
   - `003` — the table that keeps Dropbox refresh tokens off the client
   - `004` — closes public read access to `shared_links` and switches it to
     token hashes; on a new project it finds nothing to fix and does nothing
   - `005` — creates `shared_links`, the table public share links live in
   - `006` — drops a dead policy on `files` and writes the Storage bucket and
     its policies down, so they stop living only in the dashboard
   - `007` — adds `profiles.bytes_used` and the trigger that keeps it and
     enforces the storage limit. **Apply it before deploying the code**: the
     API and the client both read that column, and without it uploads fail
   - `008` — drops `early_access`, a Pro-plan waitlist table that existed in the
     database, in no migration and in no line of code, and was accepting
     anonymous writes. On a new project it finds nothing and does nothing
   - `009` — pins the `search_path` of two trigger functions, and takes back
     the `EXECUTE` grant that three had inherited and no caller needed
   - `010` — constrains `files.download_url` to `http(s)`. The row is written
     by the browser, and a `javascript:` URL in it became the Download button
     of a share page
   - `011` — search by meaning: the `vector` extension, the `file_embeddings`
     table with a read-only policy, and `match_files`, the function that ranks
     a caller's own rows
   - `012` — takes back the table grants `anon` and `authenticated` had
     inherited and nothing used. `TRUNCATE` was among them, and row-level
     security does not apply to it
   - `013` — constrains `files.storage_path` to the row owner's own folder, so
     that a row cannot name somebody else's object
   - `014` — refuses a `storage_path` that a URL parser would rewrite: `..`, a
     backslash, a percent sign, a control character
   - `015` — reads `auth.uid()` once per query, not once per row, in the five
     policies that compare a column with it

   All sixteen are safe to re-run, so there is no need to track which ones have
   already been applied.

3. Enable **Google Auth** in Authentication -> Providers if needed.
4. The `files` bucket and its policies come from migration `006` — nothing to click.
   Creating the bucket by hand in the dashboard is what left a fresh project with
   RLS on `storage.objects` and no policies, so every Supabase Storage upload failed.

#### Cloudinary

1. Register on [Cloudinary](https://cloudinary.com/users/register/free)
2. No upload preset. Uploads are signed per request by `/api/cloudinary/sign`,
   which needs `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and
   `CLOUDINARY_API_SECRET` set server-side (see the Vercel step below).
   - If you previously created an **unsigned** preset for this app, disable it:
     Settings → Upload → Upload presets. An unsigned preset lets anyone holding
     the cloud name — which ships in the client bundle — write into the account
     without having one here, and it is the path on which the storage quota was
     checked by nothing but the browser.
3. Enable PDF delivery: Settings → Security → Allow delivery of PDF and ZIP files

#### Cloudflare R2

1. Create a bucket and an API token with object read/write on it, then set
   `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET_NAME`
   server-side, plus `VITE_R2_BUCKET_NAME` so the client knows R2 is available.
2. **Add a CORS policy to the bucket.** Uploads go from the browser straight to
   R2, so without one every upload fails at the preflight:

   ```json
   [
     {
       "AllowedOrigins": ["https://your-project.vercel.app", "http://localhost:8100"],
       "AllowedMethods": ["GET", "PUT"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"]
     }
   ]
   ```

   `ExposeHeaders: ["ETag"]` is the line that is easy to miss and hard to
   diagnose. Large files go up in parts, and the browser has to read each
   part's `ETag` to tell R2 how to reassemble them; without it the parts upload
   perfectly and the final assembly is rejected. The client says so by name
   rather than letting that happen.
3. Optional but recommended: a lifecycle rule that aborts incomplete multipart
   uploads after a few days. An upload nobody resumes leaves its parts in the
   bucket, and they are billable.

#### Vercel API (for file deletion)

1. Register on [Vercel](https://vercel.com/)
2. Connect your Git repository
3. Add environment variables in Vercel. **Server-only — never with a `VITE_`
   prefix**, which would inline them into the public bundle:
   - `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID_PRO_MONTHLY`, `STRIPE_WEBHOOK_SECRET`
   - `DROPBOX_APP_KEY` (only if Dropbox is enabled)
   - `ANTHROPIC_API_KEY` + `VOYAGE_API_KEY`, or `CLOUDFLARE_AI_TOKEN` for the
     free path (only for semantic search). Pair them with
     `VITE_SMART_SEARCH_ENABLED=true`, which is what puts the mode on screen:
     without it the dashboard offers the search it always had, and `/api/ai/*`
     answers `501` to anything that asks anyway
4. After deployment, copy the API URL and add it to `.env`:
   - `VITE_CLOUDINARY_DELETE_API_URL=https://your-project.vercel.app/api/cloudinary/delete`

> ⚠️ Check that `SUPABASE_SERVICE_ROLE_KEY` really holds the **service-role**
> key, not the anon key — they look alike and Supabase shows them side by side.
> Pasting the wrong one leaves every server-side query silently returning zero
> rows. See the [postmortem](#-postmortem-the-anon-key-that-was-named-supabase_service_role_key)
> for the one-liner that tells them apart.

#### Stripe (for the paid tier)

1. Create a product and a monthly price in the [Stripe Dashboard](https://dashboard.stripe.com/)
   and put the price id in `STRIPE_PRICE_ID_PRO_MONTHLY`
2. Add a webhook endpoint pointing at `https://your-project.vercel.app/api/stripe/webhook`,
   subscribed to `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted` and `invoice.payment_failed`
3. Copy that endpoint's signing secret into `STRIPE_WEBHOOK_SECRET` — the one
   `stripe listen` prints is for local development only and will not verify
   production events
4. Set `VITE_BILLING_ENABLED=true` to show the plans page, and
   `VITE_BILLING_DEMO_MODE=true` while running on test keys
5. Locally, forward events instead of registering an endpoint:
   `stripe listen --forward-to localhost:8100/api/stripe/webhook`

#### Google Drive (optional)

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/)
2. Enable Google Drive API
3. Create OAuth 2.0 Client ID
4. Add `VITE_GOOGLE_CLIENT_ID` to `.env`

#### Analytics (optional)

Analytics are automatically enabled in production when environment variables are set.

**Google Analytics 4:**

1. Create a property in [Google Analytics](https://analytics.google.com/)
2. Get your Measurement ID (starts with `G-`)
3. Add `VITE_GA4_MEASUREMENT_ID` to `.env`

**Hotjar:**

1. Create a site in [Hotjar](https://www.hotjar.com/)
2. Get your Site ID from the tracking code
3. Add `VITE_HOTJAR_SITE_ID` to `.env`

> **Privacy First**: Hotjar only runs on web (not native mobile apps). File names and sensitive data are automatically masked using `data-hj-suppress` attributes.

### 4. Run Application

```bash
# Development mode
npm run dev

# Production build
npm run build

# Preview build
npm run preview
```

The app will be available at: `http://localhost:8100`

## 📦 Tech Stack

- **Frontend**: React 19 + Ionic 9 + TypeScript 5.9
- **Public site**: Next.js 16 (App Router). Every page is prerendered but the one a share link opens, which is rendered when it is asked for. It is `apps/web`, a Vercel project and an origin of its own
- **File Storage**: Cloudinary, Supabase Storage, Cloudflare R2, Google Drive, Dropbox (Pro)
- **Search by meaning**: pgvector in Postgres, with Claude and Voyage or Cloudflare Workers AI writing and embedding the descriptions
- **Database**: Supabase (PostgreSQL, RLS)
- **Authentication**: Supabase Auth
- **Billing**: Stripe (Checkout, Customer Portal, webhooks)
- **State Management**: TanStack Query + React Context API
- **Routing**: React Router 7
- **Build**: Vite + Capacitor
- **Workspace**: Nx, five projects: the app, the public site, the functions and two libraries. It keeps them apart by lint, caches tasks and tells CI what a push touches
- **Backend API**: Vercel Functions
- **Testing**: Vitest (node and jsdom projects) + Playwright (e2e), run in GitHub Actions
- **Analytics**: Google Analytics 4 (GA4) + Hotjar
- **Error Tracking**: Sentry

## 🏗️ Architecture

```mermaid
flowchart TB
    subgraph browser["Browser · Ionic React PWA"]
        ui["Pages and services"]
        anon["supabase-js<br/>anon key, subject to RLS"]
    end

    subgraph vercel["Vercel"]
        static["Static bundle"]
        api["Serverless functions · /api<br/>service-role key, bypasses RLS"]
    end

    subgraph data["Supabase"]
        db[("Postgres<br/>RLS on every table")]
        auth["Auth · JWT"]
        sb_store["Storage · private bucket"]
    end

    subgraph external["Providers and services"]
        r2["Cloudflare R2"]
        cloudinary["Cloudinary"]
        drive["Google Drive"]
        dropbox["Dropbox"]
        stripe["Stripe"]
    end

    ui --> anon
    anon -->|"read own rows"| db
    ui -->|"authenticated calls"| api
    ui -->|"direct upload with a presigned URL"| r2
    ui -->|"direct upload, signed by /api"| cloudinary

    api --> db
    api --> sb_store
    api -->|"presign, delete"| r2
    api -->|"sign upload, delete — both ownership checked"| cloudinary
    api -->|"checkout, portal"| stripe
    api -->|"OAuth exchange, token refresh"| dropbox
    ui --> drive

    stripe -->|"webhook · signature verified"| api
    auth --- anon
    auth --- api

    guest["Recipient of a share link<br/>no account"] -->|"opens /s/token"| site["Public site · Next.js<br/>another origin, no secrets"]
    site -->|"what the link holds: name, size, type"| api
    guest -->|"asks for the file, when the button is pressed"| api
```

**The rule the layout follows:** anything holding a secret runs in `/api`. The
browser bundle is public — Vite inlines every `VITE_`-prefixed value the app
reads into it — so provider credentials, the Stripe secret key, the Supabase service-role key
and Dropbox refresh tokens are only ever read server-side. The client talks to
Postgres directly, but always through the anon key with RLS applied, and only
for rows it owns.

Uploads are the deliberate exception: files go from the browser straight to the
provider — a presigned URL for R2, a per-request signature for Cloudinary —
because proxying them through a serverless function would cap uploads at
Vercel's 4.5 MB request body limit. That means no server sees the bytes, so the
quota cannot be enforced by watching them go past. It is enforced where the
upload has to end up instead: a trigger on `files` checks the limit and updates
the counter in one statement, under a row lock, so two simultaneous uploads
cannot both fit into the same remaining space. `/api` still refuses over-quota
uploads first, to save the round trip — but it is the pre-flight, not the gate.

### Security decisions worth knowing

| Decision                                                                              | Reason                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Billing columns are server-write only                                                 | RLS has no column-level granularity, so a self-update policy would let anyone set `tier = 'pro'`                                                                                                                                                                                                      |
| Dropbox refresh tokens live in `dropbox_connections`, never in the browser            | an XSS could otherwise reach the user's Dropbox indefinitely                                                                                                                                                                                                                                          |
| Share tokens are stored as SHA-256 hashes                                             | a leak of `shared_links` then reveals nothing usable                                                                                                                                                                                                                                                  |
| `assertServiceRoleKey` refuses to start on an anon key                                | swapping the two keys fails silently: queries return nothing instead of erroring                                                                                                                                                                                                                      |
| Ownership is checked in `/api`, never trusted from the client                         | the presigned URL writes straight to the bucket, so the client check is advisory                                                                                                                                                                                                                      |
| The storage quota is enforced by a trigger on `files`, not only in `/api`             | uploads go from the browser straight to the provider, so no handler sees them; the row is the one thing every path must reach, and a row lock there also closes the check-then-act race the API check had on its own                                                                                  |
| Cloudinary uploads are signed per request, never by an unsigned preset                | an unsigned preset is writable by anyone holding the cloud name, which ships in the client bundle — and it was the path production used for every image                                                                                                                                               |
| The quota trusts the size on the row, and this says so rather than implying otherwise | uploads never pass through a server, so nothing server-side can weigh them; the trigger makes the limit unskippable and the race impossible, and the declared size is the honest boundary of what that buys                                                                                           |
| The demo endpoint needs a server-side `DEMO_ENABLED`, not just the client flag        | a route that creates accounts should not open because a `VITE_` variable was left set in a preview                                                                                                                                                                                                    |
| Demo accounts are swept by email prefix, never by age alone                           | the sweep runs with the service-role key; a filter on age alone would eventually reach a real account                                                                                                                                                                                                 |
| The demo rate limit is 20/hour per address, and per instance                          | an office or a campus behind one NAT is a single address, so a tight limit turns away the visitors this exists for; the counter lives in module scope, so it resets on a cold start and is not a defence against a distributed attempt — a shared counter is what all of these limits still want |
| Share and upload limits count per account, and per address before the token check    | an address can be a whole office, so the limit that matters belongs to the account; the address one runs first because validating a token costs a round trip that an anonymous caller must not be able to buy by repeating the request. Revoking a share link is exempt                                |
| A share link at the app's old address is sent on before the app starts                | the app tells its analytics where it is as soon as it starts, and at that address the address is the token: until links moved to the site, every one opened on the app was sent to Google Analytics                                                                                                   |

### Security headers

`vercel.json` sends a Content-Security-Policy, HSTS, `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy` and `X-Frame-Options` on every response.
The interesting parts:

- **`frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`,
  `form-action 'self'`** — the four that cost nothing and buy the most:
  clickjacking, plugin content, a rewritten `<base>`, and a form posting
  credentials to somebody else's host.
- **`script-src` still carries `'unsafe-inline'`**, and that is a real weakness
  rather than an oversight. The build emits no inline `<script>` at all — gtag.js
  and Hotjar are what need it. Removing it means per-request nonces, which need
  a server rendering the HTML rather than a static bundle.
- **`connect-src https:` is deliberately wide.** The Supabase project ref, the R2
  account and the Sentry ingest host all differ per deployment, and `vercel.json`
  is checked in, so a hardcoded list would break every fork.

`libs/server/src/csp.test.ts` parses the header out of `vercel.json` and asserts that every
origin the app injects a script from is allowed. The policy is a string inside a
JSON file — nothing else in the toolchain can see it, and a mistake there shows
up only in production, in whichever browser the visitor happened to bring.

### What the browser downloads first

Measured from `npm run build`, gzipped, before anything is rendered:

|                             | Before                     | After                      |
| --------------------------- | -------------------------- | -------------------------- |
| Initial JS + CSS            | 1 863 KB / **451 KB gzip** | 1 714 KB / **401 KB gzip** |
| Chunks on the critical path | 6                          | 6 (Sentry out, facade in)  |

Two changes, both cheap:

- **Sentry is no longer imported at startup.** It sat at the top of `main.tsx`
  _and_ of `ErrorBoundary.tsx`, so 151 KB of crash reporter (51 KB gzipped, an
  ninth of the shell) was fetched before the first paint — by a library that has
  nothing to report until the app is running. `src/observability/sentry.ts` is
  now a facade every module imports instead; the real package arrives on
  `requestIdleCallback`, and events raised in the meantime are queued rather
  than dropped. The cost, stated plainly: `browserTracingIntegration` no longer
  sees the initial pageload transaction.

  Two traps on the way, both only visible in the build output:

  1. `import('@sentry/react')` resolves to the whole module namespace, which
     Rollup must keep intact — every integration the package ships became
     reachable and the chunk grew from 151 KB to **494 KB**. Importing
     `observability/sentry-client.ts`, which re-exports exactly four symbols,
     gives Rollup a namespace small enough to shake against.
  2. Rollup then merged the facade _into_ the Sentry chunk, so the static import
     pulled the reporter back onto the critical path — the lazy import bought
     nothing, and `dist/index.html` still listed `sentry-*.js` under
     `modulepreload`. `manualChunks` now assigns the facade its own chunk.

- **Inter is linked from `index.html` with a preconnect.** It was an `@import` at
  the top of `theme/variables.css`, which is the slowest way to load a font: the
  browser has to download and parse that stylesheet before it discovers a font
  is needed at all.

The remaining 239 KB gzipped is Ionic, and it is structural rather than
something to tune — the framework registers its components eagerly.

#### The number is now a budget, not a note in a README

`npm run size` measures what `dist/index.html` actually pulls in — the entry
script, every preloaded chunk, every stylesheet — and fails when it grows past
a ceiling set just above today's figure. It runs on every push and prints the
table onto the run page:

| | Measured | Budget |
| --- | ---: | ---: |
| First load (JS + CSS) | 437.2 kB | 445 kB |
| Largest chunk (Ionic) | 245.5 kB | 260 kB |
| All assets, route chunks included | 530.2 kB | 540 kB |

A budget set to a round number nobody measured gets raised the first time it is
hit. These are set a few percent above the build, so the pull request that adds
a 40 KB dependency is the one that has to justify it.

Those are the figures of 4.9.0, as CI measured them. When the check was written
the three ceilings were 420, 250 and 520 kB, over a first load of 401.0 kB. They
have been raised once, for React 19 and Ionic 9, which cost 22.4 kB between
them. `scripts/check-bundle-size.js` says where that went.

The public site has one budget, for the one page whose visitors are the least
likely to have anything cached: the page a share link opens, which moved there
from the app
([decision 0014](docs/decisions/0014-the-public-pages-are-a-second-app.md),
step 5). The site's smoke test loads it in a browser and adds up the scripts
and styles that arrived, gzipped the same way: 142.0 kB, under a ceiling of
148, where the app's first load is three times that. 1.0 kB of it is the
page's own. The rest is React and Next.js, which every page of the site
carries, the four that do nothing in a browser included.

#### Lighthouse, on the same run

`npm run lighthouse` audits the built `dist/` with the desktop preset. That is
one page, the shell: it is the only HTML the app's build emits. Current scores:

| | Performance | Accessibility | Best practices | SEO |
| --- | ---: | ---: | ---: | ---: |
| App shell | 97 | 100 | 100 | 100 |

CI asserts accessibility, best practices and SEO at ≥ 95 — near-deterministic
audits of markup and metadata — and performance at ≥ 80, low enough that a busy
runner cannot fail the build on its own and high enough to catch a blocking
script returning to the critical path.

Two static legal pages were audited beside the shell until they became pages of
the public site. They had not started at 100. The first run found body text at
`#999` on white (2.8:1, against the 4.5:1 that text needs), links distinguished
by colour alone, no meta description, and four GitHub links pointing at a
username that does not exist — leftovers of a rename that the earlier link
sweep missed because those two pages were static HTML and nothing else
referenced them. Lighthouse does not audit the site. What it asked of those two
pages about accessibility, the site's smoke test now asks of every page there,
with axe at WCAG 2.1 A and AA.

## 🚀 Deployment

### Vercel (recommended)

1. Install Vercel CLI: `npm install -g vercel`
2. Deploy: `vercel --prod`

That deploys the app and its functions, from the root of the repository. The
public site is a second Vercel project, with `apps/web` as its Root Directory.
Its framework, install command, build command and output directory are stated
in `apps/web/vercel.json`, because a project rooted in a folder that has no
such file is built with the one at the root, and that one is the app's.

## 📱 Mobile app

The iOS project is in `ios/` and the app runs: built with Capacitor 8 against
Xcode 26.6, launched on an iPhone 17 simulator under iOS 26.5.

Four Capacitor plugins do the work that makes it a shell rather than a frame
around a website: the system share sheet for links, a keyboard that resizes the
body instead of the whole WebView, haptic feedback on the one irreversible tap,
and a status bar that follows the theme. The status bar is left **overlaying**
the page — `setOverlaysWebView(false)` is the Android reflex, and on iOS it
insets the WebView and fills the gap with the window background, which is a
black band with no clock in it. Ionic's `--ion-safe-area-top` already keeps
every header clear of it.

<p align="center">
  <img src="docs/screenshots/ios-login.png" alt="The app running on an iPhone 17 simulator: the sign-in card, Sign in with Google, and Just looking? Open a demo account" width="320">
</p>

```bash
npm run build
npx cap sync ios
npx cap open ios     # then Run, or:
npx cap run ios --target "<simulator id from npx cap run ios --list>"
```

**Requirements**: a Mac with Xcode. CocoaPods is *not* needed — Capacitor 8
distributes plugins through Swift Package Manager. Publishing to the App Store
additionally needs an Apple Developer account ($99/year).

### What the shell needed that the browser did not

A Capacitor WebView serves the page from `capacitor://localhost`, and that one
fact broke three things. All three are fixed;
[ADR 0010](docs/decisions/0010-the-native-shell-has-its-own-origin.md) has the
reasoning.

- **Eleven `fetch` calls named their route with a path.** Correct in a browser,
  where the page and the functions share a deployment; a 404 in the shell.
  `apiUrl()` prefixes `VITE_API_ORIGIN` when — and only when — the app is
  running natively, so the web build still calls its own deployment.
- **The API had to be told who is calling.** `capacitor://localhost` (iOS) and
  `https://localhost` (Android) are answered by name, never `*`: these routes
  read bearer tokens and open Stripe sessions. The list said `http://localhost`
  for Android until 2026-09-30, and every `/api` call from that shell failed.
- **A shell's origin is not the app's address.** The demo's seed assets are
  built on the deployment's own URL, never on the caller's `Origin`. A share
  link's address is the public site's and asks no request anything — a link
  made on a phone used to point at the phone.
- **Sign in with Google could not come back to a page.** It leaves through the
  system browser and returns through `com.cloudstorage.app://auth/callback`.

### Two settings that live outside this repository

Email and password sign-in works on the device as built. Google does not until
both of these are in place:

1. **Supabase → Authentication → URL Configuration**: add
   `com.cloudstorage.app://auth/callback` to the redirect allow-list.
2. **Google Cloud console**: add an iOS OAuth client for the bundle id
   `com.cloudstorage.app`.

### If `codesign` refuses the bundle

> `App.app: resource fork, Finder information, or similar detritus not allowed`

This repository lives in an iCloud-synced folder, and the file provider stamps
`com.apple.FinderInfo` on directories it syncs — including the ones
`npx cap run ios` creates under `ios/DerivedData`, which codesign then refuses.
Xcode's own derived-data location is outside the synced tree, so opening the
project and pressing Run works; the CLI's in-project path is what fails. To
stay on the command line, point the build somewhere else:

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination "id=<simulator id>" -derivedDataPath ~/Library/Developer/Xcode/DerivedData/CloudStorage build
```

### Android

`android/` is in the repository and the app runs: built with Capacitor 8 against
JDK 21 and the Android 35 SDK, launched on a Pixel 7 emulator running Android 15.

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

**Requirements**: a JDK 21 and the Android SDK — `brew install openjdk@21` and
`brew install --cask android-commandlinetools`, then `sdkmanager` for
`platform-tools`, `platforms;android-35`, `build-tools;35.0.0`, `emulator` and a
system image. Android Studio is not needed to build or run; it is only an editor.

**Sign-in needed the one native thing iOS already had.** An `intent-filter` in
`AndroidManifest.xml` for `com.cloudstorage.app://auth/callback` — what
`CFBundleURLTypes` does on iOS. Without it Google sign-in leaves the app and
never comes back. Nothing else needed changing: `apiUrl()` had already solved
the relative-`/api` problem for both shells.

<img src="docs/screenshots/android-login.png" alt="The app running on a Pixel 7 emulator: the sign-in card, Sign in with Google, and Just looking? Open a demo account" width="320">

**About the band across the top of that screenshot.** It is not the app. Capacitor
hands the display cutouts to CSS only when the WebView is at version 140 or
newer; below that it insets the WebView itself, deliberately, to work around a
Chromium safe-area bug. The Android 15 emulator image ships WebView **124**, so
it takes the older path. `StatusBar.setOverlaysWebView` cannot override it — that
API is implemented with `SYSTEM_UI_FLAG_*` constants which stopped having any
effect at API 35, and calling it was removed for reading as though it worked.

**Not done**: publication. That needs a Play Console account, and the app is not
for sale. [`docs/store-submission.md`](docs/store-submission.md) is the checklist
for if that changes — what is already done, what each store's privacy form wants,
and the two items that cannot be started without paying.

## 📁 Project Structure

```
cloud-storage-app/
├── src/
│   ├── pages/
│   │   ├── Login.tsx              # Login/Register page
│   │   ├── Dashboard.tsx          # User file list
│   │   ├── Upload.tsx             # File upload page
│   │   └── FileView.tsx           # File view/manage page
│   ├── services/
│   │   ├── auth.service.ts        # Authentication service
│   │   ├── storage.service.ts     # Main file service
│   │   ├── cloudinary.service.ts  # Cloudinary service
│   │   ├── googledrive-auth.service.ts  # Google Drive OAuth
│   │   └── googledrive.service.ts # Google Drive service
│   ├── providers/
│   │   ├── storage.provider.ts    # Storage Provider architecture
│   │   └── impl/                  # Provider implementations
│   ├── contexts/
│   │   └── AuthContext.tsx        # Authentication context
│   ├── components/
│   │   ├── PrivateRoute.tsx       # Protected route component
│   │   └── PageViewTracker.tsx    # Analytics page view tracker
│   ├── observability/
│   │   ├── sentry.ts              # Facade — keeps Sentry off the critical path
│   │   └── sentry-client.ts       # Four re-exports, so the chunk stays shakeable
│   ├── hooks/
│   │   └── useAnalytics.ts        # GA4 + Hotjar analytics hook
│   ├── types/
│   │   └── analytics.types.ts     # Analytics event types
│   ├── supabase/
│   │   └── supabase.config.ts     # Supabase configuration
│   ├── App.tsx                    # Main component
│   └── main.tsx                   # Entry point
├── api/                           # Vercel Functions — anything holding a secret
│   ├── account/delete.ts          # Erases the caller's account and everything under it
│   ├── ai/[action].ts             # Search by meaning: describe a file, embed a query
│   ├── cloudinary/[action].ts     # sign (quota-checked) and delete (ownership-checked)
│   ├── demo/session.ts            # Throwaway account for "Try the demo"
│   ├── dropbox/                   # OAuth exchange, token refresh, disconnect
│   ├── r2/                        # Presigned URLs, quota enforced here
│   ├── share.ts                   # Create, describe, open and revoke share links
│   └── stripe/                    # Checkout, Customer Portal, webhook
├── apps/
│   └── web/                       # The public pages: Next.js, a Vercel project and an origin of its own
├── libs/
│   ├── core/                      # What the app, the site and the functions all use (tiers, plans, upload parts, URL rules)
│   └── server/                    # What only the functions may use (auth, signing, Stripe, erasure)
├── migrations/                    # The whole schema, in order, each re-runnable
├── e2e/                           # Playwright specs
├── capacitor.config.ts            # Capacitor config
├── vite.config.mts                # Vite config (incl. vendor chunk splitting)
├── nx.json                        # Nx: which tasks are cached, and on what
├── .nxignore                      # What is not the app: documentation
└── package.json
```

Anything that needs a secret lives in `api/`. The browser bundle is public — Vite
inlines every `VITE_`-prefixed value the app reads into it — so provider credentials, the
Stripe secret key, the Supabase service-role key and Dropbox refresh tokens are
only ever read server-side.

> **`api/` is full.** Vercel turns every `.ts` file there into its own Serverless
> Function and the Hobby plan allows twelve; `api/demo/session.ts` was the
> twelfth. This is why `api/share.ts` routes three verbs through one file, and
> why the next server-side route has to either share an existing file or wait
> for a plan that allows more. It already cost one thing worth naming: a
> collector for CSP violation reports, which would have let the policy run in
> report-only mode first.

## 🔒 Limits and Restrictions

### Application

|                    | Free                                           | Pro ($9/mo)        |
| ------------------ | ---------------------------------------------- | ------------------ |
| Storage            | 500 MB                                         | 5 GB               |
| Providers          | Cloudinary, Supabase Storage, R2, Google Drive | + Dropbox          |
| Provider selection | automatic                                      | manual, per upload |

- **Extra storage**: Google Drive (15 GB free) — auto-connects when limit is reached
- **Max single file size**: not enforced. The figure of 50 MB appeared here before
  anything implemented it; no check exists in the client, in `/api`, or on the
  bucket (`file_size_limit` is null). Providers impose their own ceilings — Vercel
  caps a function request body at 4.5 MB, which is why R2 uploads are presigned.
- Cancelling Pro drops the limit back to 500 MB. Files already stored stay
  readable; only new uploads are refused until the account is back under quota.

### Cloudinary (Free Plan)

- **Storage**: 25 GB
- **Bandwidth**: 25 GB/month
- **Transformations**: 25,000/month

### Supabase (Free Tier)

- **Database**: 500MB
- **Storage**: 1GB (5GB bandwidth)

## 🛠️ Development

```bash
# Linting: the app, the functions and the libraries
npm run lint

# The public site in apps/web has its own: lint, unit tests, dev server, build, smoke test
npm run lint --workspace @cloud-storage/web
npm test --workspace @cloud-storage/web
npm run dev --workspace @cloud-storage/web
npm run build --workspace @cloud-storage/web
npm run smoke --workspace @cloud-storage/web

# Code formatting
npm run format

# Unit tests (Vitest) — both of the app's projects, server and client
npm test

# ...with the coverage report CI prints as two tables
npm run test:coverage

# End-to-end tests (Playwright)
npm run test:e2e

# Type-check src and api, then build
npm run build

# What the browser downloads before first paint, against its budget
npm run size

# Lighthouse against dist/ — the same audit CI asserts on
npm run lighthouse

# Regenerate the demo seed files and the link-preview image
npm run generate:demo-assets

# The same checks through Nx, which repeats only what has changed since it last ran them
npx nx run-many -t lint typecheck test
```

GitHub Actions runs lint, both type-check passes, an audit of production
dependencies, a bundle-size budget, Lighthouse, unit and e2e tests on every
pull request that changes the app. The e2e suite runs against two dev servers: one as deployed, and
one with `VITE_R2_BUCKET_NAME` set, where the resumable-upload spec answers
every `/api/r2/*` call itself, and in three Playwright projects: Desktop
Chrome, the same browser pointed at the R2 server, and Pixel 7 for the specs
whose subject is the phone. `main` is protected:
those checks are required, and changes land through pull requests only.

The repository is an Nx workspace of five projects: the app at its root, the
public site in `apps/web`, the functions in `api/`, and two libraries,
`libs/core` and `libs/server`;
[decision 0014](docs/decisions/0014-the-public-pages-are-a-second-app.md) says
where that is going. Nx does three things here today. It keeps the projects
apart: only the functions may import `libs/server`, lint refuses anything
else, and `libs/boundaries.test.ts` holds the rule to that. The test asks the
real ESLint config about eighteen imports, then reads the import graph of the
code as it stands, which a disable comment cannot edit. It caches `build`,
`lint`, both type-checks and the unit tests, and its cache key includes a
fingerprint of the env files, which git ignores and Vite inlines into the
bundle. And CI asks it what a push touches, and gets two answers. A change to
the site runs the site's steps: its lint, its unit tests, its build, and a
smoke test that asks the built site for its HTML with no script run and then
opens every page in a browser. It does not run the app's end-to-end suite, so
no account is opened in the live database for a sentence on the first page or
in the privacy policy. A change
to the app leaves the site alone, and a change to what both read, `libs/core`
or the lock file, runs both.
Documentation is listed in `.nxignore`, so a push that changes nothing else
skips every step and the required checks still end green. A push to `main`
runs everything regardless.

### What the tests cover, and what they deliberately do not

Two Vitest projects, because the two halves of this app run in different
places: `server` executes the Vercel handlers and the `libs/` helpers under
node, `client` renders the React layer under jsdom. CI prints their coverage
as two tables — a single blended percentage would hide which half a pull
request moved.

The site has a third, `site`, which its own `npm test` runs and the app's does
not: the reader of the two legal documents, and both documents put through it,
so that a construct it does not know fails a test and is not printed on a page.
It also holds the two halves of the page a share link opens: what the site
asks the functions about a link and how long it keeps the answer, and what the
browser does with the address it is handed for the file.

That page cannot be tried against the real functions from a laptop or from CI:
`/api/share` answers a browser on the production site's origin and no other.
So the site's smoke test brings a stand-in for them,
`apps/web/scripts/stub-api.mjs`, builds the site to take it for the app, and
presses the button in a real browser. Each thing it claims about the page was
broken once on purpose, to see the test fail. It failed for ten of eleven. The
eleventh, a script handed over as the file's address, it passed while the
browser ran the script, and it was the test that was fixed.

The two badges at the top of this file are those two numbers, and they are
deliberately not averaged into one. The client badge is the lower of the two by
a long way, and it is meant to be: the pages are where the untested code is. With
the page a share link opens gone to the site, `src/pages` is 620 statements and
the unit tests reach 324 of them. `Dashboard.tsx` is the largest at 163, and 66
of those are reached. Five smaller pages have no unit test at all, the plans
page among them. That is the largest untested thing in the repository, and it
is named here rather than hidden behind one average that would sound fine.

The target is not a percentage. It is that everything deciding **access,
money and quota** has a test:

- `authenticateUser` — the gate every handler goes through, and the one thing
  every handler test mocks, so it needs a test of its own.
- `ProviderManager.selectProvider` — which backend a file lands on, and that
  choosing one by hand still cannot walk past the quota.
- The rollback in `storage.service.uploadFile` — the bytes reach the bucket
  before the row exists, so a failed insert has to delete them again. The
  compensating half of a transaction Postgres cannot give us.
- The storage meter — cancelling Pro drops the limit back to 500 MB without
  deleting anything, so the bar stops at full while the number keeps counting.
- Share-link state — `stateOf()` in the browser deliberately re-implements
  `shareUnusableReason()` from `libs/server/src/share.ts` rather than pull `node:crypto`
  into the bundle. Two implementations can drift; each side is tested.

What a page does from end to end is left to Playwright rather than jsdom: `e2e/`
opens a throwaway account per test and drives the real file lifecycle, share
links, quota, folder navigation, search, a multi-file upload and the offline
queue against a live Supabase project. Rendering a page in jsdom proves the
markup exists; it does not prove an upload works. The unit tests that five of
the pages do have are about what a page decides, not what it draws: that a
deletion asks first, that a failed change says so, that a queue keeps going
after one file is refused, and that nothing is offered for sale inside the
native shell.

**One check runs the built bundle rather than the source.** `npm run smoke`
opens `dist/` in a real browser and asks two questions: whether the page
rendered anything at all, and whether the service worker keeps to the app. It
exists because nothing else could: `npm run dev` serves unbundled modules, so
`manualChunks` in `vite.config.mts` never executes there, and the Playwright
suite runs against that dev server. A split that put React and react-dom in
different chunks painted a blank page while lint, 621 unit tests, the whole
e2e suite and the bundle budgets stayed green. The service worker is out of
sight the same way. The dev server generates one of its own, which falls back
to the app shell for `/` alone, while the built one answered every navigation
in its scope, `/api/` and file paths included.

**Accessibility is asserted on the rendered DOM**, at WCAG 2.1 A and AA, by
`@axe-core/playwright` — on the login page, the dashboard with folders and
files on it, the upload page with a queue, the file view and the plans page.
`eslint-plugin-jsx-a11y` reads the source and Lighthouse audits the built
shell, which behind a login form is an empty page; everything the app actually
is had been checked by neither. The first run found
five rule classes, including a delete button nested inside the button that
opens the file, and a list whose children were not list items.

**One project runs at phone size** (`mobile`, Pixel 7) rather than repeating the
whole suite twice. It carries the checks whose subject is the phone itself:
that nothing scrolls sideways, that the primary action answers a tap rather than
only a mouse, and that the layout at that width is as accessible as the wide
one. The app is sold as a PWA and shipped through Capacitor, and CI used to
measure one browser at one size.

## 🔍 Postmortem: the `anon` key that was named `SUPABASE_SERVICE_ROLE_KEY`

Worth writing down, because no test in this repository could have caught it —
the bug was not in the code at all.

**The symptom.** Right after billing went live in production, `Upgrade to Pro`
answered with `500` and a message the handler itself raises:

```
No profile row for user 4a242a2f-... — has migrations/001_add_profiles_and_billing.sql been run?
```

The migration had been run. The row was there — a direct query against the
database returned it, `stripe_customer_id` and all.

**The cause.** Every serverless function builds its Supabase client in
`libs/server/src/auth.ts` from `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The project
URL was correct. The key was not: decoding the JWT payload showed
`"role": "anon"`. An anon key had been stored under the service-role name, in
all three Vercel environments, 221 days earlier.

A service-role key bypasses RLS; an anon key does not. `profiles` allows
`SELECT` only on `auth.uid() = id`, and a server-side client carries no user
session — so it matched zero rows. Postgres was not broken and RLS was not
misconfigured. The server was simply asking as a stranger.

**Why it stayed hidden for so long.** Until v3 the production branch had no
`api/` directory, so none of this code ever ran there. It also survived a
signed-webhook check that returned `200`: that probe used an event type the
handler ignores, so it never touched the database. The first request that
actually read a table was the one that failed.

**How to check a key in one line.** The role is in the JWT payload, in plain
sight:

```bash
# prints: anon  — or: service_role
cut -d. -f2 <<< "$SUPABASE_SERVICE_ROLE_KEY" | base64 -d 2>/dev/null | sed 's/.*"role":"\([^"]*\)".*/\1/'
```

**What it changed here.** Two habits, both cheap:

- verify what a secret _is_, not what the variable is called — names are set by
  hand, and a hand can paste the wrong value;
- when a green check is claimed as proof, ask which code path it actually
  exercised. A `200` from a probe that never reached the database proved only
  that the signature matched.

A sibling of the same class had been fixed days earlier: `STRIPE_WEBHOOK_SECRET`
in production held a secret from `stripe listen`, left over from local testing,
while the Stripe account had no registered webhook endpoint at all. Both were
configuration, both were invisible to CI, and both only surfaced when a real
request finally travelled the whole path.

## 🔍 Postmortem: the dependency policy that hid the vulnerabilities it was meant to avoid

`.github/dependabot.yml` ignores major version bumps, and the reasoning was
sound enough to be worth quoting: majors are migrations, not updates, and the
first Dependabot run proposed seven at once — Capacitor 6 to 8, Ionic 8 to 9,
TypeScript 5 to 7, react-router 6 to 7, ESLint 8 to 10 — two of which failed CI
outright. The comment ended with a sentence that turned out to be false:

> Minor and patch still arrive weekly, **which is where security fixes land.**

**The symptom.** `npm audit --omit=dev` reported nine vulnerabilities, four of
them high, against a repository whose checks had been green for months. Twelve
separate `undici` advisories — request smuggling, CRLF injection, response
queue poisoning — reachable through `@vercel/node`, which was pinned at 5.x
while 10.x was current.

**The cause.** The fix was only available in a major, so the ignore rule
suppressed it, and Dependabot opened nothing. Nothing else was watching: CI ran
lint, two type-check passes, unit tests and Playwright, and not one of them has
an opinion about a published advisory. The policy did not fail — it worked
exactly as written, and what it was written to do turned out to include this.

**What it took to clear.** Less than the alert count suggested, because the
count was measuring the wrong thing:

- `@vercel/node` is imported for `VercelRequest` and `VercelResponse` and
  nothing else — Vercel supplies the runtime itself. It belonged in
  `devDependencies` all along, where its transitive tree never reaches
  production.
- `ajv` was a direct dependency that no file in this repository imports. It came
  in transitively through `vite-plugin-pwa` and `eslint` regardless.
- `cloudinary` was the one genuine production high, and the only real migration:
  v1 to v2. The app uses `v2.config()` and `v2.uploader.destroy()`, neither of
  which changed.

Production dependencies went from nine vulnerabilities (four high) to three
(one low, two moderate, none high). The two that remained were `react-router`,
which needs the v7 migration, and a pinned `esbuild` — both known, neither
hidden.

The `esbuild` one turned out not to be a production dependency at all. It had
been pinned into `dependencies` to fix a Vercel build that a hand-pinned
`@esbuild/darwin-arm64` had broken — the remedy for which was to stop declaring
the binary, not to declare the compiler. No file imports it, and Vite resolves
its own nested copy regardless. Dropping the declaration took production
dependencies from 106 to 100 and the report to **0 critical, 0 high, 2 moderate,
0 low**, which is the same lesson one layer down: an advisory count is only as
honest as the boundary it is counted against.

**What changed.** One CI step, which is the part that matters more than the
upgrades:

```yaml
- name: Audit production dependencies
  run: npm run audit:prod
```

The step ran `npm audit --omit=dev --audit-level=high` directly until v4.2.0,
when a registry outage failed it twice in a day and the command moved into
[`scripts/audit-production.mjs`](scripts/audit-production.mjs) — which tells a
verdict from an unreachable endpoint. `--omit=dev` is load-bearing and unchanged
in either form. A vulnerability in a build tool is not a vulnerability in what
the browser downloads, and a step that fails over one trains people to skip
reading it. The ignore rule stays — it was right about churn — but it is no
longer the only thing standing between an advisory and this repository.

The habit this adds to the [first postmortem](#-postmortem-the-anon-key-that-was-named-supabase_service_role_key)'s
two: a policy that suppresses noise needs something else watching for what it
suppresses, or the silence it produces is indistinguishable from safety.

## 💎 Pro Tier

Shipped in [v3.0.0](https://github.com/Alexandr-Paleev/CloudStorageApp-Ionic/releases/tag/v3.0.0). Upgrading happens in the app, through Stripe Checkout.

|                        | Free                                           | Pro — $9/month |
| ---------------------- | ---------------------------------------------- | -------------- |
| Storage                | 500 MB                                         | **5 GB**       |
| Providers              | Cloudinary, Supabase Storage, R2, Google Drive | **+ Dropbox**  |
| Choose upload provider | —                                              | ✅             |
| Google Drive overflow  | ✅                                             | ✅             |

Manage or cancel a subscription from the Stripe Customer Portal, reachable from
the plans page. Cancelling there keeps Pro until the end of the period already
paid for, and the tier then drops back to Free — see
[Limits](#-limits-and-restrictions) for what happens to files already stored.
When a cancellation takes effect is a setting of the portal, which lives in
Stripe and not in this repository.

> **The public demo runs on Stripe test keys.** Real cards are declined; use
> `4242 4242 4242 4242` with any future expiry and any CVC. Nothing is charged.

### Not built (and not promised)

Earlier versions of this README advertised OneDrive, AWS S3, team collaboration
and white-labelling as "coming soon". None of that exists, and none of it is
planned — the list is gone rather than left to age.

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

Code style is enforced automatically — ESLint and Prettier run on staged files through a pre-commit hook, so there is nothing to configure by hand. Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`).

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Support

- 💬 **Issues**: [GitHub Issues](https://github.com/Alexandr-Paleev/CloudStorageApp-Ionic/issues)
- 📧 **Email**: support@cloudstorage.app (for Pro customers)

## 📄 Legal

- **[Privacy Policy](https://cloud-storage-web-xi.vercel.app/privacy)** - How we handle your data
- **[Terms of Service](https://cloud-storage-web-xi.vercel.app/terms)** - Rules and guidelines

Both are pages of the public site, built from
[`apps/web/content/`](apps/web/content). That folder holds the only copy of
either: the app links to the pages and renders neither.

## 🌟 Star History

If you find this project useful, please give it a ⭐ on GitHub!

---

**Created with ❤️ by Aleksandr Paleev**

**Stack**: Ionic + React + Next.js + TypeScript + Nx + Supabase + Cloudinary + Stripe + Vercel
