# 0014 — The public pages are a second app, on an origin of its own

Accepted · 2026-10-08 · step 4 of 6 built

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

## Update — 2026-10-09, step 3, second half

The rule is in, and step 3 is built. The app, the functions, `libs/core` and
`libs/server` are four projects, and lint refuses an import that crosses from
one to another except where the plan above allows it.

- **The open question is settled: a function cannot import a library by
  name.** It was settled with Vercel's builder, run here on one function,
  rather than on a preview deployment: a preview shows whether a function
  answers, and the builder run here shows what it was given. Three ways were
  tried. A name from tsconfig `paths`, and an npm workspace whose `exports`
  point at the `.ts` sources or at the `.js` the builder writes. None of the
  three fails the build, and all three fail to load with `MODULE_NOT_FOUND`:
  the builder leaves a name as written, and at run time the name leads
  nowhere. A build that passes over a function that cannot start is the
  worst outcome there is, so the second way out above is the one taken. The
  functions and `libs/server` keep their relative imports, and the rule is
  told to let those through. This was `@vercel/node` 12.0.1, the version the
  lock file named that day.
- **`libs/core` has a name, and `libs/server` does not.** The app imports
  `@cloud-storage/core/...`. For `libs/server` the only spelling left to the
  app is a relative path, and the rule refuses a relative path that leaves
  its project. A name would have made the import one that TypeScript and
  Vite accept and lint alone refuses. The tags are the second lock: given a
  name for a moment, the app's import was refused as `scope:app` reaching
  past `scope:core`.
- **The rule can stop working without anything turning red, so it is held
  to its job twice.** It reads the project graph from disk, and where there
  is none it prints a warning and checks nothing: `eslint .` on a fresh
  checkout exited 0 with the rule off. On a pull request CI happens to ask
  Nx a question first, which leaves a graph behind. On `main` it does not.
  The ESLint config now draws the graph before it lints.
  `libs/boundaries.test.ts` then asks the real config about thirteen
  imports, and after that reads the graph of the code as it stands. The
  second half stands on its own: a disable comment silences the rule for a
  line and leaves the import in the graph.
- **Three settings were wrong from the moment there was a second project.**
  Nx was not reading imports at all, so the graph had no edges. It reads
  them only when one of a handful of its packages is installed, or when
  told. The tasks at the root cover the whole repository while their cache
  key covered the root project alone, so a change under `api/` was handed
  the result of the run before it. And Vite's build found the name by
  itself, while its dev server answered 500 and Vitest could not resolve it.
- **The tasks did not move.** Lint, the type-checks and the tests still run
  once, from the root, over everything. The libraries and `api/` are
  projects with a tag and no targets. Giving each its own tasks belongs
  with step 6, when the root stops being the app.

## Update — 2026-10-09, step 4, first part

Step 4 goes in as three changes: the site and its first page, then the
plans, then the legal pages. This is the first. `apps/web` is a Next.js app,
it renders one page into HTML, and nothing in the app has changed. The
links to the legal pages still lead to the app, and the static copies in
`public/` are still there.

- **The site is an npm workspace, and the repository is its root.** Vercel
  wants a `package.json` where a project is rooted, and `next` in the root
  one would have declared the app dependent on a framework it does not use.
  The root package is still the app, and there is still one lock file.
- **Installed alone, it builds alone.** Vercel installs a project rooted at
  `apps/web` from inside that folder, and npm then installs that workspace
  and nothing else: 34 packages, none of them the app's or the functions'.
  That failed twice before it worked. The root `prepare` script ran husky,
  which is not among the 34. And Next, finding no TypeScript, installed the
  newest one, which is two majors ahead of the one this repository pins and
  rejects `tsconfig.base.json`. So `prepare` tolerates a missing husky, and
  the site names its own TypeScript.
- **CI gives two answers, which is what "CI runs what a change can affect"
  above was promising.** A change under `apps/web` runs the site's lint, its
  build, the boundary test and a smoke test, and none of the app's steps:
  no end-to-end run, no accounts in the live database. A change to the app
  leaves the site's steps alone. Getting Nx to say so took one correction.
  The root project's tasks were keyed on every file in the workspace, and a
  project keyed that way counts as touched by every file; a pattern that
  excludes a folder does not take its files back out. The root now names
  what its tasks read: its own files, `api/` and `libs/`.
- **The site may import `libs/core` and nothing else of ours.** Its tag is
  `scope:web`, the boundary test asks about five more imports, and the graph
  it reads has the site in it. The test runs with the site's steps as well,
  because a disable comment in a page is exactly what it is there for.
- **Lint is per project now.** The root `lint` leaves `apps/` out and the
  site has its own, with Next's rules. One config serves both, and the
  folder ESLint is started in differs between them, which is the kind of
  thing a relative path in a config gets wrong in one of the two.
- **The site sends the app's headers and a narrower policy, with one
  concession.** Scripts are allowed inline. Next writes its bootstrap that
  way, and the alternative is a nonce minted per request, which means no
  page is prerendered. These pages take no input and show nothing a visitor
  wrote, so the policy keeps the half that matters here: no script from
  another origin, no frame, no form posted elsewhere.
- **One advisory moved.** `source-map-js` was already in the tree, below
  the build tools, where the production audit does not look. Next depends
  on it at run time, so it became a production dependency and the audit
  turned red. It is updated, and the audit now covers 128 packages where it
  covered 108.

Not in this change, and not forgotten: the Vercel project for the site is
made by hand, Lighthouse does not audit the site yet, and the first page
makes no claim that depends on which keys a deployment has.

### The first deployment, and what it added

The project was made the same day, rooted at `apps/web`, and its first
deployment failed. Next built every page, and then Vercel looked for an
output directory named `dist`.

- **The site states its own configuration, in `apps/web/vercel.json`.** The
  project's settings said Next.js, and the build was not run as one: it ran
  `npm run build` and then expected `dist`, the way the app is built. Those
  are the values of the `vercel.json` at the root of the repository, which
  is the app's. A project rooted in a folder is documented to read that file
  from the folder, and this one had none there. Now it has, and it names the
  framework, the install, the build and the output directory, so that
  nothing outside `apps/web` decides them.
- **The install it names is the one that was tried first.** Left to itself
  Vercel saw Nx in the repository and installed everything from the root:
  1034 packages, a minute. The site's file asks for its own workspace, which
  is 34.
- **The smoke test asks whose policy the site sends.** The root file also
  carries the app's headers, the content security policy among them. The
  site's policy names no origin but its own and the app's names eleven, so
  the test fails on a policy that names one.
- **What local checks could not see.** Everything about this was right on a
  laptop and in CI. Only the platform reads that file, and the first place
  the site met the platform was its first deployment. The site's pull
  requests get a preview from now on, which is where the next such thing
  will show.

## Update — 2026-10-09, step 4, second part

The plans are on the site, at `/pricing`, and the app and the site read them
from one place.

- **The plans are in `libs/core`: the name, the price, and what each says
  it gives.** Until now the price was in the app twice, as `$9` typed into
  the page and as 900 cents beside it that the page did not use. The storage
  each plan promises was written out as text, next to the numbers that
  enforce it. The line about storage is now made from the limit, and a test
  holds the two together.
- **`format` moved to `libs/core`, as the first half of step 3 said it would
  when a second side asked.** The site is that side. The module gained one
  function: a limit is stated as the round number somebody chose, "500 MB",
  where a measurement keeps its decimals.
- **The price on the page is not the price that is charged.** That one is
  configured in Stripe, and nothing in this repository can compare the two.
  It was as true before. The code now says it where the price is written.
- **The site says that paying is a demonstration.** The app's deployment
  runs Stripe on test keys, and its own pricing page says so to someone who
  has signed in. The site says it to someone who has not. It is a constant in
  the site's code rather than a variable: the day billing goes live changes
  more than one sentence, and should be a commit somebody reads.
- **Not every line on the page is true of this deployment.** The feature
  lines other than storage are the app's own copy, moved as they were so
  that the app's page did not change in a pull request about where text
  lives. Two of them, "Basic analytics" and "Priority support", describe
  nothing this repository implements, and "All providers + Dropbox" names a
  backend the production deployment has switched off. They were shown to
  people who had signed in; they are now shown to anyone. Rewording them is
  a decision about the product, and it is one line in `libs/core`.
- **The smoke test asks about width.** Adding one link to the header pushed
  the page sideways on a 320-pixel screen. That was caught on a screenshot
  and not by a check, so the test now loads both pages at three widths.

## Update — 2026-10-09, step 4, third part

The terms and the privacy policy are pages of the site, at `/terms` and
`/privacy`, and the app holds no copy of either. Step 4 is built.

- **The two documents moved into the site.** The plan said the legal pages
  would render the same markdown, and they do. It did not say where the
  markdown would be. It was at the root of the repository, where the app
  imported it. The site is its only reader now, so it is in
  `apps/web/content/`, inside the site's project. That is what answers the
  last line of the context above: a sentence changed in the privacy policy
  runs the site's steps, and no account is opened in the live database for
  it.
- **The reader of that markdown is the site's, and not a library.** It is
  the one the app had, moved with the documents. `libs/core` is for what two
  sides use, and one side reads these. It learned two things on the way.
  The terms end on an emphasised line that the app printed with its
  asterisks, and their three steps of dispute resolution were three
  paragraphs. It is still not a markdown library. The documents use
  headings, lists, rules, bold, emphasis and links, and a test puts both
  through the reader and fails on anything else, so the day one of them
  gains a table is found out in a test.
- **A link from one document to the other is a link to a file.** That is
  right on GitHub, where the documents are also read, so the documents keep
  it. The site turns a file name into its page. The app did not, and inside
  the terms the link to the privacy policy opened the app's shell at an
  address it had no page for.
- **The app links to the site, and its old addresses lead there.** The
  links on the login page and the plans page open the site's pages in a tab
  of their own. `vercel.json` redirects the two routes and the static pages,
  with and without `.html`: six addresses. The two routes also forward from
  inside the app, because a browser the service worker controls is given
  the shell without the server being asked, and a native shell has no
  server in front of it. In a native shell the page does not forward. It
  shows the link and waits, since the window it would replace is the app.
- **The redirects are temporary ones.** A permanent redirect is remembered
  by the browsers that followed it, and the site's address is the one
  Vercel gave it, which a domain would replace.
- **The address of the site is written twice, and a test holds the two
  together.** Once in `libs/core/src/origins.ts`, beside the app's, for the
  app and the site to read. Once in `vercel.json`, which cannot import. The
  site had typed the app's address for itself, and reads it from the same
  module now.
- **The static copies are gone, and so is what audited them.**
  `public/privacy-policy.html` and `public/terms-of-service.html` were the
  only HTML besides the shell that the app's build emitted, and Lighthouse
  audited all three. It audits the shell now. Nothing audits the site with
  Lighthouse, so the site's smoke test took over the question those two
  pages were asked about accessibility: every page of the site is put
  through axe at WCAG 2.1 A and AA.
- **The site has unit tests, and the app's test run does not include
  them.** They are a third Vitest project, run by the site's steps. Their
  types are checked with the repository's other tests, from the root,
  because the site's own type-check is `next build` and a build of the site
  alone has no Vitest to check them against. CI therefore runs that
  type-check for a change to the site too.
- **What the two pages say was not edited.** They were moved as they were,
  for the reason the plans were. Both still carry a contact address at
  `example.com`, and the terms name `[Your Jurisdiction]` as the governing
  law. The privacy policy gives January 10, 2026 as the day it was last
  updated, and gained a section on 2026-09-27. All of that was public
  before, on the app. It is public now on the site, which lists both pages
  in its sitemap.

Two things about this part were not seen working before it merged, and
could not be. The redirects are applied by Vercel, and a preview deployment
answers every request with a redirect to a login. What was checked instead
is the table Vercel's own routing library builds from the file: the six
redirects come before the filesystem and before the rewrite that serves the
shell. And the native shells were not run. What happens to a link there was
read in Capacitor's source: on both platforms it does not load another
origin in the app's window, and asks the system to open it.

## Update — 2026-10-10, step 5, first part

Step 5 goes in as three changes, as step 4 did: the API learns what the page
will ask of it, then the page, then the links move. This is the first.
Nothing a visitor sees has changed. The app's own page still opens every
share link, the way it did.

- **`/api/share` can describe a link without opening it.** `GET` with the
  token and `describe` answers with the file's name, size and type. It finds
  the link and refuses it exactly as opening does, so a link that is revoked,
  expired or unknown is not described either. It signs nothing.
- **A description asks the database for three columns.** Opening a link reads
  where the file is kept and whose it is, because it signs an address.
  Describing does not read them at all. The answer could have been narrowed
  after reading the whole row, and then one edit to the answer would be
  enough to hand the rest out.
- **The site is a reader, and a reader is given less than a shell.** The
  record above says the API gains an allowed origin, as it did for the shells
  in 0010. It gains one on one route, and for reading. The site's origin is
  answered on `/api/share` and on none of the other eleven functions. It may
  use `GET`, and it is not told it may send an `Authorization` header. A
  shell is the app somewhere else, and signs in. The site has no session to
  send, so there is nothing it needs that a preflight has to allow, and a
  page on its origin can neither make a link nor revoke one.
- **Only the production site is named.** A preview of the site is another
  origin and is not answered, and neither is a site running on a laptop. The
  second change has to decide how the page is tested against an API that
  will not answer it from there.
- **Nothing is cached here.** The record above says that what a page says
  about a link is cached for a short while. That is the page's cache, and it
  belongs to the second change. The API answers every request it is asked.

One thing was not seen working before it merged: the answer to a preflight.
The dev server answers `OPTIONS` itself, before the function is reached, so
what the function says to one is held by unit tests until production can be
asked.

## Update — 2026-10-10, step 5, second part

The site has the page a share link opens, at `/s/` and the token. Nothing
leads to it yet. Links are still issued on the app, and the app's own page
still opens every one of them. A link opens on the site when its token is
put after the site's address by hand, and that is how this part is tried.

- **It is the one page of the site that is rendered when it is asked for.**
  The others are written out when the site is built. This one is about a
  link its owner can take back, so no copy of the page is kept anywhere, and
  a function answers every request for it. It is not the first function the
  site has on Vercel. Vercel keeps one behind each prerendered page as
  well: its list for the site had 27 entries before this change and has 29
  with it. It is the first that answers a visitor. The other pages are
  answered with the file written at build time, and say so in a header.
- **A page says one of four things.** What the link holds, with a button.
  That the link was revoked or has expired, in the functions' own sentence.
  That there is no file behind it, which is answered 404. Or, when the
  functions could not be asked, that a file was shared and its name could not
  be read, and that page still has the button. The button asks from the
  visitor's browser, and a visitor is counted apart from the site, so a file
  can be had while its name cannot.
- **What is kept is the answer, for a strict minute, in the memory of one
  instance.** The record above says a description is cached for a short
  while. An answer older than a minute is shown to nobody: the next visitor
  waits for a new one. It is per instance for the reason the functions'
  limits are (0007), and how often an answer is reused on Vercel depends on
  how long Vercel keeps an instance, which nothing here measures.
- **It is not Next's cache, and the reason was measured.** Next can keep the
  answers to `fetch`, with a lifetime. It keeps an answer of 200 and no
  other, and goes on serving the one it has until a newer 200 replaces it.
  A revoked link answers 410, so nothing ever does. Built that way with a
  lifetime of two seconds, the page named the file 4, 6, 10, 20 and 30
  seconds after the link was revoked, on every visit, while the functions
  answered each of those five visits with 410.
- **A minute is what taking a link back costs.** The download is refused at
  once, because it is asked for separately and nothing about it is kept. The
  page goes on naming the file until the minute is up. The smoke test does
  exactly that: it opens a page, revokes the link, presses the button, is
  refused, reloads, and reads the name again.
- **A link that does not exist is a 404 with no words in it.** Next answers a
  404 raised while a page is rendered on demand with an empty document, and
  the browser puts the page together from what came with it. With or without
  `force-dynamic`, it was the same. The other choice was to answer 200 and
  have the words in the HTML, and the status was kept: every other page of
  this site has its words in the HTML, and this answer does not.
- **A revoked link is a 200.** The App Router can answer 404 from a page and
  cannot answer 410. The functions still do, to whoever asks them.
- **The card is the file's.** A messenger is given the file's name as the
  title, with its size and type. On the app a link unfurls as "Cloud Storage
  App", whichever file it is. Two things about the card were found by
  looking. A page that sets its own loses the image the layout had, which
  has to be handed on. And the tags are in the head only because the page
  and its metadata wait for the one answer: Next writes them into the body
  for any reader it does not know by name whose page was ready first. When
  the two were made to ask separately, that is where the tags went.
- **The policy names the app on this page and on no other**, in
  `connect-src`, so that the button may ask. It still allows inline script,
  and the reason the first part of step 4 gave no longer covers every page:
  this one shows a name a stranger wrote. What stands between that name and
  a script is React writing it out as text. The page is rendered on demand,
  so it could carry a nonce, and does not yet. It is also on an origin where
  nobody is signed in. As a page of the app, the same name was shown beside
  a session.
- **The address the browser is sent to is asked about twice.** The
  functions refuse to hand out anything but an http(s) address, and the page
  asks again before it goes there. With that second check taken out, the
  browser in the smoke test was handed a script for an address and ran it.
- **The page is tried against a stand-in for the functions.** The first part
  left this open. The real functions answer a browser on the production
  site's origin and nowhere else, so the smoke test starts a stand-in and
  builds the site to take it for the app. The stand-in is a copy of what
  `/api/share` answers, and nothing holds the copy to the original but
  reading both. The original is checked by the app's end-to-end suite.
- **Each thing the test claims was broken once, to see it fail.** Eleven
  ways: the policy naming somebody else, or naming the app on every page,
  the page opening the link when it is rendered, a refusal kept as an
  answer, nothing kept, anything taken for a token, the page left open to
  indexing, the card without its image, a missing link answered 200, an
  ended link keeping its button, and the address not checked. The test
  noticed ten. The eleventh it passed, with the browser running the script:
  a script address that comes to a value replaces the page with that value,
  and the test was looking at the page for a mark the script had left. It
  looks at the window now.
- **What a recipient downloads has a budget.** 142.0 kB of scripts and
  styles, gzipped, counted the way the app's first load is, under a ceiling
  of 148. Built on the same machine the same day, the app's first load is
  437.6 kB. Of the 142.0, the page's own script is 1.0. The rest is React
  and Next, and every page of the site carries it, the four that do nothing
  in a browser included. The HTML is 3.2 kB, and about 16 kB more is fetched
  ahead for the links in the header and the footer.
- **The app's address is now written twice in the site.** `next.config.ts`
  needs it for the policy and cannot import it: Next compiles its config
  apart from the site and resolves a tsconfig's `baseUrl` against the folder
  it runs in, and ours is declared two folders up. A test holds the copy to
  `libs/core`, and the smoke test holds the policy to the address the page
  sends people to.
- **One line outside the site changed.** The site's unit tests could not
  import `libs/core` by name, because Vitest does not read
  `tsconfig.base.json` unless told, and until now no test of the site had
  asked. That line is in the root's Vitest config, so this change runs the
  app's checks as well as the site's.

Several things about this part cannot be seen before it is merged. The page
is rendered by a function on Vercel and by a Node server everywhere it was
tried. The preview of this change shows that the function was built, as
`s/[token]`, and not what it answers: a preview answers every request with
a redirect to a login. The function asks the app's functions over the
network, from an address that is Vercel's. The policy for this page is the second of two
rules that set one header, and Vercel's router applies them, not Next. And a
preview of the site describes a link and cannot download it, because a
preview is another origin. After the merge the smoke test is pointed at
production, where it asks about a link nobody made: that is a 404 only if
the real functions answered, and a page with a button if they did not. A
real link is then opened there by hand.
