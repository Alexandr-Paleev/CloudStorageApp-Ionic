-- Migration: pin the search_path, and take back the grants nobody meant to give
-- Run this in Supabase SQL Editor.
--
-- `handle_new_user` is the SECURITY DEFINER trigger that writes a `profiles`
-- row when someone signs up. It runs as its owner, and it is the only one of
-- this schema's four definer functions without a pinned `search_path`:
--
--   enforce_storage_quota   SET search_path = public, pg_temp
--   recount_storage_used    SET search_path = public, pg_temp
--   rls_auto_enable         SET search_path = pg_catalog
--   handle_new_user         —
--
-- Unpinned, the function resolves unqualified names through whatever
-- `search_path` the *caller* had. The attack that follows from that is real
-- enough that Supabase's own linter has a rule for it
-- (`function_search_path_mutable`): create a table, a function or an operator
-- in a schema that sorts earlier, and a definer function can be made to run
-- against it with the owner's rights.
--
-- **It is not exploitable here, and this is hardening rather than a fix.** Two
-- things stop it, and this migration removes the reliance on the second:
--
--   * the one table it touches is written `public.profiles`, fully qualified;
--   * no role can create anything to shadow it — checked on 2026-09-06,
--     `has_schema_privilege` says CREATE on `public` is false for `anon`,
--     `authenticated` and `service_role` alike.
--
-- The second of those is a property of the current grants, not of this
-- function, and it is the kind of thing a later migration changes without
-- anyone connecting the two. Pinning the path makes the function correct on its
-- own terms.
--
-- `pg_temp` is last on purpose: a temporary schema is writable by any session,
-- so leaving it off the end of the list is what stops a caller from planting a
-- shadow there. Postgres searches it first unless told otherwise.
--
-- `handle_updated_at` is in the same state and is fixed here too. It is not
-- SECURITY DEFINER, so it runs with the caller's rights and the escalation
-- above does not apply — but it is a trigger on `profiles`, the table that
-- carries the billing tier, and a trigger whose name resolution depends on
-- whoever happened to fire it is not something to leave written down.
--
-- The second half of this file is about grants rather than paths.
-- Supabase's own linter reports it as `anon_security_definer_function_executable`,
-- and a check of `proacl` says the same: `enforce_storage_quota`,
-- `handle_new_user` and `handle_updated_at` all carry `anon=X` and
-- `authenticated=X`, which is what PUBLIC EXECUTE decays into. Verified against
-- production on 2026-09-06:
--
--   POST /rest/v1/rpc/handle_new_user        → 404 PGRST202 (no callable signature)
--   POST /rest/v1/rpc/enforce_storage_quota  → 404 PGRST202
--   POST /rest/v1/rpc/rls_auto_enable        → 400 0A000  ← reached the executor
--   POST /rest/v1/rpc/recount_storage_used   → 401 42501  ← locked down already
--
-- So nothing here is exploitable today: all four return `trigger`, which
-- PostgREST will not expose, and the one that does reach Postgres is refused by
-- Postgres itself. The point is the last line of that table. `recount_storage_used`
-- is granted to `postgres` and `service_role` only, which is the posture every
-- one of these should have had; the others differ because they were created
-- without a REVOKE and inherited the default. A trigger function has no caller
-- but the trigger.
--
-- `rls_auto_enable` is deliberately left alone: it is Supabase's own
-- `ensure_rls` event trigger, not this project's, and taking grants off managed
-- objects is how a migration ends up fighting the platform on the next upgrade.
--
-- Applied to production on 2026-09-06. Safe to run twice: ALTER FUNCTION ... SET
-- is idempotent, and a REVOKE of a grant that is already gone is a no-op.
--
-- Verified afterwards on production rather than assumed: all three functions
-- report a pinned path and an ACL with no `anon` or `authenticated`, and a real
-- sign-up through `/api/demo/session` created its `profiles` row — the trigger
-- fires as the table's owner, so taking EXECUTE off the callable surface does
-- not touch it. Supabase's own security advisor went from ten findings to four,
-- and both `function_search_path_mutable` warnings are gone.

BEGIN;

-- ALTER rather than CREATE OR REPLACE: the bodies are not changing, and
-- rewriting them here would mean this file has to be kept in step with the
-- migrations that own them.
ALTER FUNCTION public.handle_new_user() SET search_path = public, pg_temp;
ALTER FUNCTION public.handle_updated_at() SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_storage_quota() FROM PUBLIC, anon, authenticated;

COMMIT;

-- Verify — expects both rows reading {search_path=public, pg_temp}, and neither
-- ACL mentioning anon or authenticated:
--
--   SELECT p.proname, p.proconfig, p.proacl
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname IN ('handle_new_user', 'handle_updated_at', 'enforce_storage_quota');
--
-- And that sign-up still creates a profile: register a throwaway account and
-- check `public.profiles` has its row. The trigger is the only thing that puts
-- one there, so a broken path shows up as a user with no profile — which the
-- billing routes report as "No profile row for user <id>".
