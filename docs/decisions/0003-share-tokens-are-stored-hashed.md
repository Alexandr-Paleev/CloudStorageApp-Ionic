# 0003 — Share tokens are stored as SHA-256 hashes

Accepted · shipped in v3.1.0 · migration [`004`](../../migrations/004_fix_shared_links.sql)

## Context

A share link is a credential: whoever holds the token gets the file, with no
account and no sign-in. `shared_links` originally stored the token in plaintext
under a policy named `Anyone can read shared links by token`, defined as
`USING (true)` for role `public`.

That is not "read by token" — it is read everything. The anon key ships in the
client bundle, so one request collected every token in the database:

```
GET /rest/v1/shared_links?select=token,file_id
```

Verified against the live database before the fix.

## Decision

Two changes, and the second is the one that survives a mistake in the first:

1. No client-side read access at all. Lookup by token happens in `/api/share`
   with the service-role key.
2. The row stores `sha256(token)`. The plaintext exists only in the URL its
   owner copied.

Tokens are 32 random bytes, base64url — long enough that guessing is not an
attack worth modelling ([`lib/share.ts`](../../lib/share.ts)).

## Consequences

- A leak of `shared_links` — a backup, a permissive policy added later, a
  `SELECT` in a support query — reveals nothing usable.
- Lookup is an exact match on the hash, so a share link cannot be found by
  prefix or listed by anything other than its owner.
- The token cannot be shown again after creation. The UI hands it over once, at
  creation time, and the file page lists links by state rather than by value.
- Hashing is unsalted and unstretched, deliberately: the input is 256 bits of
  randomness, so there is nothing to brute-force and nothing to rainbow-table.
  Salting a value this size buys nothing and costs a lookup index.
