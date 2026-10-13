# 0015 — Collectors are told paths, and two of them wait for a bare address

Accepted · 2026-10-13 · not yet released ·
[`src/analytics/collectors.ts`](../../src/analytics/collectors.ts),
[`src/observability/scrub.ts`](../../src/observability/scrub.ts)

## Context

Three collectors run in the app: Google Analytics, Hotjar and Sentry. Each of
them reports addresses, and some of this app's addresses are credentials for
as long as they stand.

- A sign-in comes back with its access token and its refresh token after the
  `#`. The Supabase client reads them, asks Supabase whether they are a
  user's, and then empties the fragment.
- An OAuth callback carries its code after the `?`.
- Until 4.10.0 a share link was opened by the app, at `/s/` and a token that
  was all it took to read the file. Every link opened there was sent to
  Google Analytics. The app no longer starts at that address
  ([0014](0014-the-public-pages-are-a-second-app.md)).

That closed one address and left the rest. They were looked at in the built
app, with values made up for the purpose and every collector refused.

- **The OAuth code reached Google**, at two of its hosts, as the path of a
  page view. The app's own tracker reported a page by its path and its query
  string.
- **A sign-in's two tokens reached Sentry**, in four fields of one event: the
  address of the page, the same again inside the trace, a span described by
  it, and one end of a navigation in the breadcrumbs. That was a sign-in the
  app could not use, whose tokens stay in the address until the app moves on.
  One it accepts is cleaned out of the address after a single request to
  Supabase, so whether those tokens got out depended on what loaded first,
  and nothing made sure of the order.
- **Google Analytics does not send the fragment.** With tokens in the address
  for three seconds while it ran, no request of its carried them.
- **Stripe's return address carried the id of the checkout session**, which
  nothing in the app has ever read.

None of this could have shown in a test. Analytics start in a production
build and in no other, so the dev server starts none, and the end-to-end
suite runs against the dev server.

## Decision

**An address carries what something reads, and nothing more.** The address
Stripe returns to is a path now.

**Google Analytics and Hotjar are not started while the address has a query
string or a fragment.** Both read the address for themselves as soon as their
script runs, and neither can be told to read another. They are started at the
first moment the address is a path and nothing else. The app asks at every
change of route, and when the fragment changes, which is how the tokens of a
sign-in go. The page views the app itself sends are paths.

**Sentry starts at any address, and every address in what it sends is cut at
its `?` and its `#`.** It is the one collector that is needed at the worst
address as much as at any other: the errors most worth having are the ones at
startup. So what leaves is cleaned, on both of its ways out, by one function
that walks the whole event and cuts every string that is an address. It does
not go by a list of fields. The first list, written from memory, had one
field. Looking found three, and the breadcrumbs made four.

Three other ways were considered.

- **Give Google Analytics a cleaned address and leave it running.** It takes
  one in its configuration. But whether it then goes on reading the real one
  when the page changes is a setting of the analytics property, which is not
  in this repository, and Hotjar has no such setting at all. One rule for
  both was simpler than a rule for each.
- **Change how a sign-in returns.** Supabase can hand back a single-use code
  in place of the tokens, useless without a second value the browser keeps.
  That would take the tokens out of the address at the source. It changes
  how every sign-in returns, on the web and in both shells, and a real
  sign-in could not be tried from where this was written. It would not
  replace this decision either: there would still be a code in an address.
- **List the fields of a Sentry event that hold an address.** See above.

## Consequences

- **A visit is not counted until its address is bare.** The first page of a
  returning sign-in is counted once the tokens are gone, about as long as one
  request to Supabase takes. The page an OAuth callback lands on is never
  counted, because the app has left it by the time anything would count it.
- **Once started, the two read the address themselves, and nothing stops
  them.** The rule is about when they start. It holds because a secret gets
  into an address only by the browser being sent here from somewhere else,
  which loads the app again from the beginning. A route of the app that put a
  secret into a query string of its own would break it.
- **Sentry loses the query string of every request.** Which filter a
  request to Supabase carried, or which page of a list, is no longer in a
  breadcrumb or a span. The path and the status still are.
- **An address inside a sentence is not cut.** An error whose message quotes
  an address keeps it whole.
- **The check runs where there are collectors.** `npm run smoke` starts the
  built app at a returning sign-in and at an OAuth callback, with made-up
  values, and reads every request that leaves. Neither of the two may be
  asked for before the sign-in is accepted, and nobody may be sent a made-up
  value. Before this decision it fails on both counts. With each rule taken
  out in turn, it failed each time. But CI's build has no collectors
  configured, and there the check says so and asks nothing. In CI the two
  rules are held by unit tests. The check itself is for a laptop that has the
  keys, and for production.
- **Sentry is seen only some of the time.** It samples its traces, so the
  address it leaked from is opened four times, and a run can still end
  without one event from it. The check says when that happens.
- **Hotjar could not be watched.** It reports over a WebSocket, which the
  check does not read. What is known about it is when its script is asked
  for.
- **What was already sent is not taken back.** An OAuth code is spent the
  moment it is used. A refresh token is worth a session until that session
  ends.
