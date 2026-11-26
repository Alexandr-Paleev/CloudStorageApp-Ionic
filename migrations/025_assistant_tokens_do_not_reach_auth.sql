-- Migration: an assistant's token is no session to Supabase Auth, and stops
-- reading the moment its access is revoked
-- Run this in Supabase SQL Editor, after 024. Then, before Supabase Auth's
-- OAuth server is turned on (docs/decisions/0020), set the first function
-- below as the project's Custom Access Token hook (Authentication → Hooks).
-- Until the hook is set nothing here changes anyone's token; until the OAuth
-- server issues one, no token carries `client_id`.
--
-- What M2c found, on a local Supabase (CLI 2.111.0, Auth v2.194.0) with a
-- real assistant's token: Supabase Auth takes it as the person's own session.
-- With it, an assistant could set the account's password and sign in with
-- it (the person is signed out everywhere), write the user's metadata, start
-- an email change, approve another assistant's request in the person's name,
-- and sign the person out. Migration 024 and `authenticate` stand in front of
-- the database and our routes; nothing of ours stands in front of Auth.
--
-- Auth finds the session a token belongs to by its `session_id` claim, and
-- refuses every endpoint a session is needed for (`/user`, `/factors`,
-- `/logout`, the OAuth consent and grants) when no session has that id.
-- PostgREST and Storage do not read the claim. So:
--
--   1. The hook moves an assistant's `session_id` to `mcp_session_id` and
--      puts a fresh random uuid in its place. Auth answers such a token
--      `403 session_not_found` everywhere; the database reads it as before.
--      Never the nil uuid: Auth skips the session lookup for that one.
--   2. `assistant_session_alive()` says whether the caller's assistant
--      session still exists, for the assistant it was issued to. `/mcp`
--      asks it about every token (libs/server/src/auth.ts) instead of
--      `getUser`, which now refuses one; revoking deletes the session, so a
--      revoked token is refused at once, not at the end of its hour.
--   3. A restrictive SELECT policy, on every table and on the objects the
--      assistant may read, asks the same of a token that carries
--      `client_id`. Without it a revoked assistant could go on reading
--      straight from PostgREST until its token expires; and a token issued
--      while the hook was off (no `mcp_session_id`) reads nothing.
--
-- Rule 1 is the hook's alone: if the hook is turned off, an assistant's token
-- is a full session at Auth again, and 2 and 3 refuse it everything, which
-- is the safe way to fail.
--
-- Checked on production before writing (2026-11-26): `auth.sessions` has
-- `oauth_client_id` and `not_after`; `postgres`, which owns these
-- functions, may read `auth.sessions` and `auth.users`;
-- `supabase_auth_admin` has USAGE on `public`; no hook function exists.
--
-- Safe to run twice.

BEGIN;

-- 1. The Custom Access Token hook.

CREATE OR REPLACE FUNCTION public.hide_assistant_session(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
DECLARE
    claims jsonb := event -> 'claims';
BEGIN
    -- A person's token, as 024 reads one: no `client_id`, or a null one.
    IF claims ->> 'client_id' IS NULL THEN
        RETURN event;
    END IF;
    claims := jsonb_set(claims, '{mcp_session_id}', COALESCE(claims -> 'session_id', 'null'::jsonb));
    claims := jsonb_set(claims, '{session_id}', to_jsonb(gen_random_uuid()::text));
    RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hide_assistant_session(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hide_assistant_session(jsonb) TO supabase_auth_admin;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;

-- 2. Is the caller's assistant session still there?

CREATE OR REPLACE FUNCTION public.assistant_session_alive()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    claims jsonb := auth.jwt();
    asked_session uuid;
    asked_owner uuid;
BEGIN
    IF claims ->> 'client_id' IS NULL THEN
        RETURN false;
    END IF;
    BEGIN
        asked_session := (claims ->> 'mcp_session_id')::uuid;
        asked_owner := (claims ->> 'sub')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        RETURN false;
    END;
    RETURN EXISTS (
        SELECT 1
        FROM auth.sessions s
        JOIN auth.users u ON u.id = s.user_id
        WHERE s.id = asked_session
          AND s.user_id = asked_owner
          AND s.oauth_client_id::text = claims ->> 'client_id'
          AND (s.not_after IS NULL OR s.not_after > now())
          AND (u.banned_until IS NULL OR u.banned_until <= now())
          AND u.deleted_at IS NULL
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assistant_session_alive() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.assistant_session_alive() TO authenticated;

-- 3. An assistant reads only while its session lives.

DROP POLICY IF EXISTS "An assistant reads files only while let in" ON public.files;
CREATE POLICY "An assistant reads files only while let in" ON public.files
    AS RESTRICTIVE FOR SELECT TO authenticated
    USING ((SELECT auth.jwt() ->> 'client_id') IS NULL OR (SELECT public.assistant_session_alive()));

DROP POLICY IF EXISTS "An assistant reads folders only while let in" ON public.folders;
CREATE POLICY "An assistant reads folders only while let in" ON public.folders
    AS RESTRICTIVE FOR SELECT TO authenticated
    USING ((SELECT auth.jwt() ->> 'client_id') IS NULL OR (SELECT public.assistant_session_alive()));

DROP POLICY IF EXISTS "An assistant reads chunks only while let in" ON public.file_chunks;
CREATE POLICY "An assistant reads chunks only while let in" ON public.file_chunks
    AS RESTRICTIVE FOR SELECT TO authenticated
    USING ((SELECT auth.jwt() ->> 'client_id') IS NULL OR (SELECT public.assistant_session_alive()));

DROP POLICY IF EXISTS "An assistant reads embeddings only while let in" ON public.file_embeddings;
CREATE POLICY "An assistant reads embeddings only while let in" ON public.file_embeddings
    AS RESTRICTIVE FOR SELECT TO authenticated
    USING ((SELECT auth.jwt() ->> 'client_id') IS NULL OR (SELECT public.assistant_session_alive()));

DROP POLICY IF EXISTS "An assistant reads objects only while let in" ON storage.objects;
CREATE POLICY "An assistant reads objects only while let in" ON storage.objects
    AS RESTRICTIVE FOR SELECT TO authenticated
    USING ((SELECT auth.jwt() ->> 'client_id') IS NULL OR (SELECT public.assistant_session_alive()));

COMMIT;

-- Verify — expects the two functions, and five restrictive SELECT policies:
--
--   SELECT p.proname, p.prosecdef, array_to_string(p.proacl, ' ')
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname IN ('hide_assistant_session', 'assistant_session_alive');
--
--   SELECT c.relname, p.polname, p.polpermissive, p.polcmd
--   FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
--   WHERE p.polname LIKE 'An assistant reads % only while let in'
--   ORDER BY 1;
--
-- Probe — the hook, with no account at all (read-only):
--
--   SELECT public.hide_assistant_session(
--     '{"claims":{"sub":"s","session_id":"real","client_id":"c"}}')
--     -> 'claims';
--                    -- mcp_session_id "real", session_id a new uuid
--   SELECT public.hide_assistant_session('{"claims":{"session_id":"real"}}');
--                    -- as it was: a person's token
--
-- Probe — the policies, as an account with a file, inside a transaction that
-- rolls back (the id is that account's). No assistant session has the id
-- below, so the assistant reads nothing; the person reads as before:
--
--   BEGIN;
--   SET LOCAL ROLE authenticated;
--   SELECT set_config('request.jwt.claims', '{"sub":"<user id>","role":"authenticated",
--     "client_id":"probe","mcp_session_id":"00000000-0000-0000-0000-000000000001"}', true);
--   SELECT count(*) FROM public.files;          -- 0
--   SELECT public.assistant_session_alive();    -- false
--   SELECT set_config('request.jwt.claims',
--     '{"sub":"<user id>","role":"authenticated"}', true);
--   SELECT count(*) FROM public.files;          -- the account's files
--   ROLLBACK;
