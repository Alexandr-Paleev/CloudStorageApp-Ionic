-- Migration: drop the early_access table
-- Run this in Supabase SQL Editor.
--
-- A table that exists in production, in no migration, and in no line of code.
--
-- It was a Pro-plan waitlist: id, email, created_at, status ('pending',
-- 'contacted', 'converted'), notes. The column comments are still there and
-- still describe a feature that was never built — billing shipped in v3.0.0 as
-- Stripe Checkout, with no waitlist in front of it.
--
-- What it holds now:
--
--   * 0 rows, checked with the service role, and never more than 0;
--   * 0 references anywhere in src/, api/, lib/ or e2e/;
--   * 0 lines in migrations/ — it was created by hand in the dashboard, which
--     is why nothing in this directory has ever mentioned it.
--
-- Left alone it is not dramatic, but it is not free either. An audit on
-- 2026-09-04 found the table accepting an anonymous INSERT: PostgREST answered
-- 201 to a request carrying nothing but the anon key, and the test row was
-- removed with the service role immediately. Unauthenticated writes into a
-- table nobody reads is the shape a spam sink takes, and it will not be noticed
-- by anyone, because nothing looks at it.
--
-- The alternative was a pair of policies. That leaves a table in the schema
-- that no code opens, which costs more than it sounds like here: every file in
-- this directory is read as documentation of what the database is for, and one
-- that documents a feature that does not exist teaches the schema wrong.
--
-- So it goes, and this file is the record of what it was — which is the part a
-- DROP in the dashboard would not have left behind.
--
-- Safe to run twice.

BEGIN;

-- IF EXISTS rather than a bare DROP: this migration is expected to be re-run
-- against a database where it has already been applied, like every other file
-- in this directory.
DROP TABLE IF EXISTS public.early_access;

COMMIT;

-- Verify — expects zero rows:
--
--   SELECT tablename
--   FROM pg_tables
--   WHERE schemaname = 'public' AND tablename = 'early_access';
--
-- And that nothing was left behind by the policies that hung off it:
--
--   SELECT policyname
--   FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'early_access';
