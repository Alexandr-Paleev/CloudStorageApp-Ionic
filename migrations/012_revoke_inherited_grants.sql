-- Migration: take back the table grants nobody asked for
-- Run this in Supabase SQL Editor.
--
-- 009 did this for functions, after `proacl` showed three of them carrying
-- `anon=X` because they had been created without a REVOKE and had inherited
-- the default. This is the same finding one level up, and it was found the
-- same way — by reading the catalogue rather than the migrations. Every table
-- in `public` was handed the full set to `anon` and `authenticated`:
--
--   files, folders    DELETE INSERT REFERENCES SELECT TRIGGER TRUNCATE UPDATE
--   profiles          DELETE INSERT REFERENCES SELECT TRIGGER TRUNCATE
--   shared_links                    REFERENCES SELECT TRIGGER TRUNCATE
--
-- Three of those appear on every line and none of them were ever intended.
--
-- **Nothing here is exploitable today, and this is hardening rather than a
-- fix.** PostgREST issues SELECT, INSERT, UPDATE, DELETE and function calls;
-- it has no way to spell TRUNCATE, no DDL, and therefore no use for TRIGGER or
-- REFERENCES. The INSERT and DELETE left on `profiles` are reachable, and RLS
-- answers them with zero rows because the only policy on that table is a
-- SELECT one.
--
-- What makes it worth a migration is the same argument 002 already made about
-- this very table: a policy is the thing people edit, and a grant is the thing
-- nobody looks at. TRUNCATE is the sharpest of the three because **row-level
-- security does not apply to it at all** — a policy decides which rows a
-- statement sees, and TRUNCATE does not look at rows. The day something in
-- this project gains a way to run a statement of its choosing, the difference
-- between "RLS returns nothing" and "the grant is not there" is the difference
-- between a dull afternoon and an empty table.
--
-- What each role is left with, which is what the app actually uses:
--
--   files, folders    authenticated: SELECT, INSERT, UPDATE, DELETE
--   profiles          authenticated: SELECT           (billing is written by
--                                                      the Stripe webhook with
--                                                      the service-role key)
--   shared_links      authenticated: SELECT           (created and revoked
--                                                      through /api/share)
--   file_embeddings   authenticated: SELECT           (already, from 011)
--   anon              nothing at all, on every one of them
--
-- `anon` losing everything is not a change in behaviour: every path in this
-- app that touches these tables is signed in, and the one that is not — a
-- share link opened by a stranger — is served by `/api/share` with the
-- service-role key, which none of this touches. The demo visitor is signed in
-- too; `/api/demo/session` hands them a real account.
--
-- Applied to production on 2026-09-27. Safe to run twice: a REVOKE of a grant
-- that is already gone is a no-op, and so is a GRANT of one already held.

BEGIN;

-- 1. Nothing for the anonymous role, anywhere in this schema.
REVOKE ALL ON public.files            FROM anon;
REVOKE ALL ON public.folders          FROM anon;
REVOKE ALL ON public.profiles         FROM anon;
REVOKE ALL ON public.shared_links     FROM anon;
REVOKE ALL ON public.file_embeddings  FROM anon;
REVOKE ALL ON public.dropbox_connections FROM anon;

-- 2. For the signed-in role, exactly what the client does and nothing else.
REVOKE ALL ON public.files   FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.files TO authenticated;

REVOKE ALL ON public.folders FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.folders TO authenticated;

-- Read-only on purpose: every column here is billing state, and 002 is the
-- file that explains what happened the last time the client could write it.
REVOKE ALL ON public.profiles FROM authenticated;
GRANT SELECT ON public.profiles TO authenticated;

-- Links are minted and revoked through /api/share, which holds the token hash
-- the client never sees (0003). Reading one's own list is all the browser does.
REVOKE ALL ON public.shared_links FROM authenticated;
GRANT SELECT ON public.shared_links TO authenticated;

-- Written by /api/ai/index with the service-role key (011).
REVOKE ALL ON public.file_embeddings FROM authenticated;
GRANT SELECT ON public.file_embeddings TO authenticated;

-- Refresh tokens. RLS with no policies, and now no grants either (003).
REVOKE ALL ON public.dropbox_connections FROM authenticated;

COMMIT;

-- Verify — expects `anon` absent from every row, and `authenticated` holding
-- only what the second section granted:
--
--   SELECT table_name, grantee,
--          string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type)
--   FROM information_schema.role_table_grants
--   WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
--   GROUP BY table_name, grantee
--   ORDER BY table_name, grantee;
--
-- And then the part a catalogue cannot answer: that the app still works. The
-- e2e suite runs against this database and covers upload, rename, delete,
-- folders, sharing, quota and account deletion — a revoke that went too far
-- shows up there as a 401 or a silent empty list, not as a failed migration.
