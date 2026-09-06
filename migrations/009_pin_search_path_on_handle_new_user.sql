-- Migration: pin the search_path on handle_new_user
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
-- Not applied to production yet.

BEGIN;

-- ALTER rather than CREATE OR REPLACE: the body is not changing, and rewriting
-- it here would mean this file has to be kept in step with 001, which owns it.
ALTER FUNCTION public.handle_new_user() SET search_path = public, pg_temp;

COMMIT;

-- Verify — expects one row reading {search_path=public, pg_temp}:
--
--   SELECT p.proname, p.proconfig
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'handle_new_user';
--
-- And that sign-up still creates a profile: register a throwaway account and
-- check `public.profiles` has its row. The trigger is the only thing that puts
-- one there, so a broken path shows up as a user with no profile — which the
-- billing routes report as "No profile row for user <id>".
