-- Migration: remove client write access to billing columns on profiles
-- Run this in Supabase SQL Editor.
--
-- 001 shipped an UPDATE policy scoped to the user's own row. RLS has no
-- column-level granularity, so that policy let any authenticated user run
--   update profiles set tier = 'pro', storage_limit = ... where id = auth.uid()
-- straight from the browser and grant themselves the paid plan.
--
-- Billing columns are only ever written server-side with
-- SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS, so the client needs no write
-- access at all. The SELECT policy stays — useProfile() reads the row.
--
-- Safe to run twice, and safe to run before 001: DROP POLICY IF EXISTS and
-- REVOKE both fail outright when the table itself is missing (IF EXISTS covers
-- the policy, not the relation), so the whole thing is guarded.

DO $$
BEGIN
    IF to_regclass('public.profiles') IS NULL THEN
        RAISE NOTICE 'public.profiles does not exist yet — run 001 first; nothing to do here.';
        RETURN;
    END IF;

    DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

    -- Belt and braces: drop the table-level grant as well, so accidentally
    -- re-adding a policy later is not enough to reopen the hole.
    REVOKE UPDATE ON public.profiles FROM authenticated, anon;
END $$;
