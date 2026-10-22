-- Migration: grant the service role its tables in writing
-- Run this in Supabase SQL Editor.
--
-- Every function in api/ reaches the database with the service-role key, and
-- each of the twelve reads or writes at least one of the six tables in
-- `public`:
--
--   profiles             the three Stripe functions, and the quota check
--                        before an upload to R2 or Cloudinary
--   files, folders       /api/demo and account erasure; files also
--                        /api/share and /api/ai
--   shared_links         /api/share
--   file_embeddings      /api/ai
--   dropbox_connections  the three Dropbox functions
--
-- No migration grants the service role any of that. Production has it because
-- Supabase's default privileges gave every new table in `public` to `anon`,
-- `authenticated` and `service_role`, with every privilege. 012 took back what
-- `anon` and `authenticated` had been given and wrote out what they keep; this
-- role's grants stayed implicit.
--
-- That default goes on 2026-10-30, in existing projects too:
-- https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically
-- Tables that exist keep their grants, so production does not change. The
-- statements the notice gives for taking the default away early revoke
-- SELECT, INSERT, UPDATE and DELETE on future tables from the three roles. A
-- database built from these files after that date, on a new project, a branch
-- or a reset, would come up with six tables the service role cannot read or
-- write, and every function would be answered with 42501, permission denied.
--
-- What this grants is those four, the statements PostgREST issues, in the
-- form the notice recommends. Production's tables also give the role
-- TRUNCATE, REFERENCES, TRIGGER and MAINTAIN, from the same default. The
-- notice's statements leave those in the default, and this file neither
-- grants them nor takes them away.
--
-- **Nothing changes in production.** Its catalogue, read on 2026-10-22, shows
-- `service_role=arwdDxtm/postgres` on all six tables: every privilege below is
-- already held there. Checked on a scratch Postgres 14 that had the three
-- roles, production's default privileges for tables `postgres` creates in
-- `public`, and the notice's REVOKE applied to them. Six tables created there
-- and put through the table grants and revokes of 001 to 012, in order, left
-- the service role with none of SELECT, INSERT, UPDATE and DELETE. After this
-- file it held all four on each, and every grant on the six was the one
-- production has, MAINTAIN aside, which Postgres 14 does not know. A second
-- run changed nothing.
--
-- Safe to run twice: a GRANT of a privilege already held does nothing.
--
-- A table added after this one needs its grants in the migration that
-- creates it: what the app asks of it to `authenticated`, what the functions
-- ask of it to `service_role`, nothing to `anon`.
--
-- Pre-flight and verify. In production every row shows
-- `service_role=arwdDxtm/postgres`, before this file and after it:
--
--   SELECT c.relname, c.relacl
--   FROM pg_class c
--   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
--   ORDER BY 1;

BEGIN;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.files               TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.folders             TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles            TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dropbox_connections TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_links        TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.file_embeddings     TO service_role;

COMMIT;
