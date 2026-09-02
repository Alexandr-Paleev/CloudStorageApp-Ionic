# 0007 — Rate limits live in module scope, not in a shared counter

Accepted · shipped in v4.0.0 · [`lib/rate-limit.ts`](../../lib/rate-limit.ts)

## Context

Three routes had nothing stopping a caller from asking in a loop.
`POST /api/share` mints a credential that bypasses authentication entirely;
`/api/r2/presign-upload` and `/api/cloudinary/sign` authorize a write into a
bucket. The quota caps what an account may store, but nothing capped how fast it
could ask, and validating a token costs a round trip to Supabase whether or not
the token is valid.

The correct implementation is a shared counter — Vercel KV, Upstash Redis. It is
also a dependency, an account, and a network round trip on every request to
routes that currently serve a handful of people.

## Decision

A sliding window per key, held in module scope, with two limits on each route: a
per-address one before the token check, and a per-account one after it. The
window is one minute.

## Consequences

- A loop is stopped, which is what these routes were actually open to.
- **The ceiling is per instance and resets on a cold start.** Vercel runs several
  instances and recycles them, so this is not a defence against a distributed
  attempt, and the file says so in the first comment rather than in a footnote.
- A minute, not an hour, because the window outlives nothing else: addresses are
  shared — one office is one address — and an hour-long window turns one
  impatient caller into an hour of refusals for everyone behind the same NAT. It
  also outlives the process it is measured in during development, which is how
  the demo endpoint once locked out its own test suite.
- Refusals carry `Retry-After`, and a refused request does not spend a hit —
  otherwise a client that retries keeps pushing its own window forward.
- Revoking a share link is deliberately outside the per-account limit. It is the
  owner's brake on a leaked link; refusing it protects nothing and keeps the
  link alive for exactly as long as the refusal lasts.
- Moving to a shared counter later changes `lib/rate-limit.ts` and nothing else:
  the routes only ask "may this caller proceed".
