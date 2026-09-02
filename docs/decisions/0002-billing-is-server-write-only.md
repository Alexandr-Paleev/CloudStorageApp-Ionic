# 0002 — Billing columns are written server-side only

Accepted · shipped in v3.0.0 · migration [`002`](../../migrations/002_fix_profiles_rls.sql)

## Context

`profiles` holds `tier`, `storage_limit` and the Stripe subscription state next
to the fields a user may legitimately change. Migration `001` shipped the
obvious RLS policy: users may update their own row.

Postgres row-level security has no column-level granularity. That policy
therefore allowed, from the browser, with the published anon key:

```sql
update profiles set tier = 'pro', storage_limit = 5368709120 where id = auth.uid();
```

Anyone with an account could grant themselves the paid plan.

## Decision

Drop the policy and `REVOKE UPDATE ON public.profiles FROM authenticated, anon`.
The client keeps `SELECT` — `useProfile()` reads the row — and writes nothing.
Every write to that table happens in `/api` with the service-role key, which
bypasses RLS.

The grant is revoked as well as the policy: re-adding a policy later is then not
enough on its own to reopen the hole.

## Consequences

- There is no client-side path to any profile field, including the harmless
  ones. Anything a user should be able to change about their own profile needs
  a route in `/api` — no such field exists today.
- The Stripe webhook is the only writer of tier state, which makes it the single
  point of failure for billing. It is covered by unit tests in both directions,
  upgrade and downgrade.
- A column-level `GRANT` would be the narrower tool. It was not used: the set of
  user-writable columns is currently empty, and an empty set is better expressed
  as "no write access" than as a grant that has to be maintained.
