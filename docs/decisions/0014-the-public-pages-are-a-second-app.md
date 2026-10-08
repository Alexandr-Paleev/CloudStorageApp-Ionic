# 0014 — The public pages are a second app, on an origin of its own

Accepted · 2026-10-08 · step 2 of 6 built, and the first half of step 3

## Context

Everything this product shows anyone is the app. `/` redirects to `/dashboard`,
which sends a visitor with no session on to `/login`, so the first thing a
stranger meets is a sign-in form. The plans page is behind that form. No page
says what the product is.

Three things follow from that, and HTML that is rendered before it reaches the
browser fixes all three.

- **A share link opens the whole app to show one file name.** `/s/:token` is a
  route of the app, so a recipient who will never have an account downloads
  the same first load as an owner: 428.9 kB of JavaScript and CSS, gzipped,
  more than half of it Ionic. Only then does the page ask `/api/share` what
  the file is.
- **Every share link previews as the same card.** A messenger that unfurls a
  link does not run JavaScript. It reads the tags in `index.html`, and those
  describe the product: "Cloud Storage App", whichever file was shared.
- **The legal pages exist twice.** Stripe and the app stores read them without
  an account, so `/terms` and `/privacy` are public routes of the app,
  rendered from the markdown at the repository root. There are also two
  static copies in `public/`. Nothing in the repository links to them but
  each other, and nothing kept them in step. On 2026-10-08 the privacy
  policy the app rendered said where a file's contents go when it is
  indexed and the static copy did not, and the static terms were six
  sections shorter than the ones the app rendered.

The other half of the context is the code the two sides share. `lib/` holds
what the browser and the functions both need, next to what only the functions
may touch. Of its 27 modules the app imports four. Nothing but convention
keeps it that way: no lint rule stops a page from importing the module that
holds the service-role client.

And every push runs all of it. One run of the 43 end-to-end tests opens 30
accounts in the live database, one for each of the 29 tests that need a
session and one more through the demo endpoint. A change to a paragraph of
legal text starts that run exactly as a change to the upload path does.

## Decision

**Next.js renders what a visitor sees before having an account, and nothing
else.** That is a first page, the plans, the terms and the privacy policy, and
the page a share link opens. The app itself stays Ionic and React, in the
browser and in the Capacitor shells: sign-in, the dashboard, upload, the file
view, the account. Its own plans page stays too, because that is where an
account upgrades. The public one takes the limits from the module the app and
the functions already share, and the price joins them there, so that no page
spells it out for itself.

**It lives on its own origin, as its own deployment.** A second Vercel project
builds it. The existing project keeps its domain, its functions, its
environment and its service worker, and the two link to each other with full
addresses.

One origin for both was the obvious alternative, and Vercel can do it: an
external rewrite makes two projects one site. It was rejected for what it
costs here.

- Vercel serves a file that exists before it consults a rewrite, and the app's
  `index.html` exists at `/`. Handing `/` to another app means renaming the
  file the service worker falls back to and Capacitor loads, or adding routing
  middleware, which is code that runs before any file is served.
- The service worker answers navigations on its origin. Every public path
  would have to be carved out of its fallback, in a worker that returning
  visitors already have, and an installed app would open on the first page,
  because its manifest starts at `/`.
- Giving the domain to the new project instead would leave the functions on
  an address of their own, behind a proxy. `getAppUrl` answers with its own
  project's address whenever a request's origin is not one of that project's,
  so share links and Stripe's return addresses would point there. That is the
  code 0010 had to correct once already.

A separate origin has none of these. Until share links are issued on it,
undoing it is deleting a deployment. It is also the shape a custom domain
would take: the site at the name, the app at `app.`

**The web app holds no secrets.** It reads a share link through the API the
app already calls. The page is rendered on the server from the file's name,
type and size, so `/api/share` learns to describe a link without signing
anything. The address of the file is signed when a person asks for it, from
their own browser. A signed address in server-rendered HTML would be minted
for every bot that unfurls the link, and could be cached along with the page.

**Both apps sit in one Nx workspace, and the shared code becomes libraries.**

```
apps/
  app/     the product: Ionic and React, the PWA and the Capacitor shells
  web/     the public pages: Next.js
api/       the functions, where Vercel looks for them
libs/
  core/    what the browser and the functions both use
  server/  what only the functions may use
```

Anything may import `libs/core`. Only `api/` may import `libs/server`, and
`@nx/enforce-module-boundaries` makes that a lint error rather than a habit.
`api/` stays at the root so that the production project keeps the repository
as its root. The repository keeps one version and one changelog.

**CI runs what a change can affect.** A change under `apps/web` does not run
the app's end-to-end suite against the live database.

**The work goes in this order, and every step leaves `main` shippable.**

1. This record.
2. Nx on the repository as it stands. No file moves.
3. `lib/` becomes `libs/core` and `libs/server`, with the boundary rule.
4. `apps/web` with the first page, the plans and the legal pages, as a new
   Vercel project. The legal pages render the same markdown, the price joins
   the limits in `libs/core`, the static copies in `public/` go, and the
   app's own legal routes forward.
5. The share page. `/api/share` describes a link without signing and answers
   the web origin, new links are issued there, and the app forwards the old
   ones.
6. The app moves into `apps/app`. Last, because it changes every path and
   proves nothing on its own.

## Consequences

- **A recipient stops downloading the app.** What the share page weighs
  instead is measured in step 5 and gets a budget of its own.
- **Links already issued keep their address.** The app forwards them, and
  that can go 365 days after the switch. No link may live longer, and none in
  production is without an expiry.
- **Two origins share nothing in the browser.** The first page cannot tell a
  signed-in visitor from a stranger, every link between the two is a full
  address, and analytics count two sites unless they are joined.
- **To the API, the web app is one address.** `/api/share` allows 120 requests
  a minute from an address, and every page the web app renders asks from its
  own, whoever the visitors are. What a page says about a link is therefore
  cached for a short while: a revoked link stops downloading at once and
  stops being described within that while. The download is asked for from
  the visitor's browser and counted against the visitor.
- **The API gains an allowed origin**, a named one, as it did for the shells
  in 0010. The origin new share links are issued on becomes configuration:
  `getAppUrl` must not learn it from a request.
- **A second framework has to be kept current.** Its majors are taken by hand
  like the others (0011). The workspace installs one React, which has to suit
  Ionic and Next.js alike, and the App Router renders with a canary build of
  React that Next.js brings itself.
- **The workspace is one more thing that can be wrong.** A graph that misses
  a dependency skips a test that should have run, which is why a push to
  `main` keeps running everything.
- **Nx's cache does not reach Vercel's builds.** Vercel's remote cache plugin
  for Nx stops at Nx 19, and this workspace starts at 23.
- **Paths move twice.** Step 3 moves `lib/`, and three links from these
  records with it. Step 6 moves the app: the Capacitor projects, the bundle
  budget, the smoke test, Lighthouse, and the six links into `src/`.
- **One thing is not known yet.** The functions import shared code by relative
  path today, and Vercel compiles what it reaches that way. Whether its
  builder resolves a workspace library the same way is settled in step 3, on
  a preview deployment. If it does not, either the libraries are compiled
  before the functions are built, or the functions keep their relative
  imports and the boundary rule is told to allow them.
- **Not decided here: moving the functions into the Next.js app.** Vercel
  bundles a Next.js app's routes into as few functions as it can, so twelve
  routes would no longer be twelve functions, and the ceiling 0008 works
  around would stop binding. It would also put the service-role key and
  Stripe's in the app this record keeps free of secrets. That is a decision
  of its own.
- **Not here either: a React Native app.** `libs/core` would make one a third
  shell over the same code.

## Update — 2026-10-08, step 2

Nx is on the repository: one project, the app at the root, with its targets
taken from the scripts in `package.json`. Three things were decided on the way
that the record above does not say.

- **Documentation is outside every project.** `.nxignore` lists it, so Nx
  counts nothing as affected by a change to it. That is what lets CI skip a
  push that touches only documentation, this record included. The two legal
  documents are not on that list, because the app imports them.
- **CI asks Nx whether to run, and runs what it ran before.** The steps are
  still the npm scripts. With one project there is nothing yet for Nx to
  choose between, only whether to start at all. A push to `main` is not
  asked, and a question that fails turns the job red rather than skipping it.
- **The cache key carries a fingerprint of the env files.** Nx does not count
  a file that git ignores, `.env` is one, and Vite inlines it into the
  bundle. Without the fingerprint a build made before an edit to `.env` would
  be handed back after it.

The version taken is Nx 23.3.0, with its daemon and Nx Cloud both off.

## Update — 2026-10-08, step 3, first half

Step 3 goes in as two changes. This is the move: `lib/` is gone, and its 53
files are in `libs/core/src` and `libs/server/src`. The rule is the second
change, so that the diff which renames every shared file is not also the one
that changes what lint accepts.

- **The line is drawn by use.** `libs/core` holds what both sides import
  today: the four modules the app imports and the one that one of them
  needs. The other 22 are in `libs/server`. Some of those use nothing a
  browser lacks, `format` and `demo` among them, and they stay where they are
  until a second side asks for them. A small `libs/core` is the point:
  everything in it is one import away from the bundle. The next thing to
  join it is the price, which step 4 takes out of the app.
- **Imports are still relative.** They are longer and say nothing new. What
  the record above leaves open, whether Vercel's builder resolves a library
  by name, belongs to the second change and is not asked here. Each of the
  twelve functions traces to the same shared modules it did before the move,
  and the app builds to the same bytes.
- **Pointers moved, history did not.** The three links from older records
  into `lib/` lead to the new paths, and so do the comments that name a
  shared file, the ones in the migrations included. The changelog keeps the
  paths that were true when each entry was written, and so does the text of
  this record above.
