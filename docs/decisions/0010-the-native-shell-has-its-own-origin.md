# 0010 — The native shell has its own origin, and the API has to say so

Accepted · [`src/utils/api.utils.ts`](../../src/utils/api.utils.ts), [`lib/cors.ts`](../../lib/cors.ts), [`src/native/deep-links.ts`](../../src/native/deep-links.ts)

## Context

The README promised iOS and Android in three places for months, and nothing in
the repository had ever built either one. Adding the platform turned out to be
the easy half: `npx cap add ios`, and the login page renders on an iPhone 17
simulator on the first try.

The half that does not survive contact is every call the app makes to itself.
Eleven `fetch` calls named their route with a path — `'/api/demo/session'`,
`` `/api/r2/${action}` `` — which is exactly right in a browser, where the page
and the functions are served from the same deployment. A Capacitor WebView
serves the page from `capacitor://localhost`, and the same string resolves
against that: a local file server with no `/api` in it. Every one of them is a
404 in the shell — the demo account, the Cloudinary signature, all of R2 and
with it resumable uploads, Stripe Checkout, share links, all three Dropbox
routes.

The OAuth redirect fails for the same reason and one more. `redirectTo` was
`window.location.origin + '/dashboard'`, which is `capacitor://localhost/dashboard`
on a device — an address Google will not accept as a redirect target and
Supabase will not accept as a redirect URL. And Google refuses to sign anyone
in inside an embedded WebView at all, so even a working address would not be
enough.

## Decision

**The app knows which side of that line it is on, and says the origin out loud
only where it has to.** `apiUrl(path)` returns the path unchanged in a browser —
so a preview deployment still calls its own copy rather than production's — and
prefixes `VITE_API_ORIGIN` when `Capacitor.isNativePlatform()` is true. One
`npm run build` produces both bundles, and only the one Capacitor copies into
the app talks to another origin.

**The API answers the two shell origins by name.** `applyCors` sets the
`Access-Control-*` headers for `capacitor://localhost` and `http://localhost`
and answers the preflight itself, before the code that expects an
`Authorization` header ever sees a request that carries none.

**OAuth leaves through the system browser and comes back through a custom
scheme.** `com.cloudstorage.app://auth/callback` is registered in `Info.plist`,
listed in Supabase's URL configuration, and handled by an `appUrlOpen`
listener that turns the callback into a session.

## Consequences

- The native app is a real client of the production API rather than a WebView
  pointed at the website. `server.url` in `capacitor.config.ts` would have been
  one line instead of all of this — and would have given up the offline queue,
  the service worker cache and shipping a build at all, since the app would
  then be whatever the site is today.
- **An allowlist, not `*`.** These routes read bearer tokens, presign uploads
  and open Stripe sessions. `*` would invite any page on the internet to call
  them from a signed-in visitor's browser.
- `Vary: Origin` goes on every answer, matched or not. A cache that kept the
  header-less copy would break the shell it was cached for.
- **The native build is pinned to one deployment.** `VITE_API_ORIGIN` is baked
  in at build time, so a shell built against production stays on production —
  which is the point, but it also means a change of API host is a rebuild, not
  a setting.
- `@capacitor/core` now ships in the web bundle too, for one platform check:
  first load moved 405.3 kB → 409.1 kB against a 420 kB budget. It buys one
  build serving both, rather than two.
- **CORS is only half-deployed until the functions are.** The client change is
  inert without it: production answers the shell's preflight with `405` and no
  `Access-Control-Allow-Origin` until this ships.
- The deep link is the one part that cannot be finished in code alone. Supabase
  → Authentication → URL Configuration has to list the callback, and Google's
  OAuth client needs an iOS entry. Until then, email and password sign-in works
  on the device and Google does not.
- Both callback shapes are handled — `?code=` and `#access_token=`. The client
  runs the implicit flow today; a native app should move to PKCE, and this
  keeps working across that change rather than failing at the one moment
  nobody is watching.
