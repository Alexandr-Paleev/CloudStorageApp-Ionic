-- Migration: a token issued to an assistant reads the files and writes nothing
-- Run this in Supabase SQL Editor, after 023, and before Supabase Auth's OAuth
-- server is turned on (docs/decisions/0020). It changes nothing for anyone
-- until then: no token carries `client_id` before that server issues one.
--
-- Supabase's OAuth server gives an assistant the same kind of JWT the browser
-- holds, role `authenticated`, with one claim more, `client_id`. PostgREST and
-- Storage take it as they take the browser's, so every policy that lets a
-- person write their rows would let the assistant write them too, and read
-- what the person's own pages read besides the files.
--
-- Two kinds of restrictive policy, so the permissive ones keep saying whose
-- row it is and these add who may do what with it:
--
--   1. `files`, `folders`, and the bucket's objects: no write, of any kind,
--      by a token that carries `client_id`. Reading stays as it is: reading
--      is what the assistant is let in for.
--   2. `profiles` and `shared_links`: nothing at all. No tool reads either,
--      and the profile holds the Stripe customer and subscription ids.
--
-- What else `authenticated` holds, checked on production before writing
-- (2026-11-25): it may INSERT and DELETE `files` and `folders` and UPDATE
-- nothing; it may SELECT those two, `profiles`, `shared_links`,
-- `file_chunks` and `file_embeddings`; the SECURITY DEFINER functions it can
-- call are triggers. `file_chunks` and `file_embeddings` are written by the
-- service role alone, and are the pieces `/mcp` reads.
--
-- Not here: `/api/*`, where `authenticate` refuses such a token on every
-- route but `/mcp` (libs/server/src/auth.ts), and Supabase Auth's own
-- endpoints, which nothing of ours stands in front of (ADR 0020, M2).
--
-- `(SELECT auth.jwt() ...)`, as 015 reads `auth.uid()`: once per query, not
-- once per row.
--
-- Safe to run twice.

BEGIN;

-- 1. No writes by an assistant.

DROP POLICY IF EXISTS "An assistant does not insert files" ON public.files;
CREATE POLICY "An assistant does not insert files" ON public.files
    AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK ((SELECT auth.jwt() ->> 'client_id') IS NULL);

DROP POLICY IF EXISTS "An assistant does not change files" ON public.files;
CREATE POLICY "An assistant does not change files" ON public.files
    AS RESTRICTIVE FOR UPDATE TO authenticated
    USING ((SELECT auth.jwt() ->> 'client_id') IS NULL);

DROP POLICY IF EXISTS "An assistant does not delete files" ON public.files;
CREATE POLICY "An assistant does not delete files" ON public.files
    AS RESTRICTIVE FOR DELETE TO authenticated
    USING ((SELECT auth.jwt() ->> 'client_id') IS NULL);

DROP POLICY IF EXISTS "An assistant does not insert folders" ON public.folders;
CREATE POLICY "An assistant does not insert folders" ON public.folders
    AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK ((SELECT auth.jwt() ->> 'client_id') IS NULL);

DROP POLICY IF EXISTS "An assistant does not change folders" ON public.folders;
CREATE POLICY "An assistant does not change folders" ON public.folders
    AS RESTRICTIVE FOR UPDATE TO authenticated
    USING ((SELECT auth.jwt() ->> 'client_id') IS NULL);

DROP POLICY IF EXISTS "An assistant does not delete folders" ON public.folders;
CREATE POLICY "An assistant does not delete folders" ON public.folders
    AS RESTRICTIVE FOR DELETE TO authenticated
    USING ((SELECT auth.jwt() ->> 'client_id') IS NULL);

DROP POLICY IF EXISTS "An assistant does not upload objects" ON storage.objects;
CREATE POLICY "An assistant does not upload objects" ON storage.objects
    AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK ((SELECT auth.jwt() ->> 'client_id') IS NULL);

DROP POLICY IF EXISTS "An assistant does not change objects" ON storage.objects;
CREATE POLICY "An assistant does not change objects" ON storage.objects
    AS RESTRICTIVE FOR UPDATE TO authenticated
    USING ((SELECT auth.jwt() ->> 'client_id') IS NULL);

DROP POLICY IF EXISTS "An assistant does not delete objects" ON storage.objects;
CREATE POLICY "An assistant does not delete objects" ON storage.objects
    AS RESTRICTIVE FOR DELETE TO authenticated
    USING ((SELECT auth.jwt() ->> 'client_id') IS NULL);

-- 2. Nothing of the profile or the share links.

DROP POLICY IF EXISTS "An assistant does not reach profiles" ON public.profiles;
CREATE POLICY "An assistant does not reach profiles" ON public.profiles
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT auth.jwt() ->> 'client_id') IS NULL)
    WITH CHECK ((SELECT auth.jwt() ->> 'client_id') IS NULL);

DROP POLICY IF EXISTS "An assistant does not reach share links" ON public.shared_links;
CREATE POLICY "An assistant does not reach share links" ON public.shared_links
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT auth.jwt() ->> 'client_id') IS NULL)
    WITH CHECK ((SELECT auth.jwt() ->> 'client_id') IS NULL);

COMMIT;

-- Verify — expects the eleven policies, every one restrictive:
--
--   SELECT c.relname, p.polname, p.polpermissive, p.polcmd
--   FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
--   WHERE p.polname LIKE 'An assistant does not %'
--   ORDER BY 1, 2;
--
-- Probe — as an account with a file and a folder, inside a transaction that
-- rolls back (the ids are that account's). Each statement in the first block
-- is refused or touches nothing; the second block is the person, as before:
--
--   BEGIN;
--   SET LOCAL ROLE authenticated;
--   SELECT set_config('request.jwt.claims',
--     '{"sub":"<user id>","role":"authenticated","client_id":"probe"}', true);
--   SELECT count(*) FROM public.files;          -- the account's files: reading stays
--   SELECT count(*) FROM public.profiles;       -- 0
--   SELECT count(*) FROM public.shared_links;   -- 0
--   DELETE FROM public.files RETURNING id;      -- no rows
--   DELETE FROM public.folders RETURNING id;    -- no rows
--   INSERT INTO public.folders (name, user_id) VALUES ('probe', '<user id>');
--                                               -- refused by the restrictive policy
--   SELECT set_config('request.jwt.claims',
--     '{"sub":"<user id>","role":"authenticated"}', true);
--   SELECT count(*) FROM public.profiles;       -- 1
--   DELETE FROM public.folders WHERE name = 'no such folder' RETURNING id;
--                                               -- allowed, no rows
--   ROLLBACK;
