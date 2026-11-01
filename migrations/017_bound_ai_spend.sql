-- Migration: a daily budget for the two calls that cost money
-- Run this in Supabase SQL Editor, after 016.
--
-- `/api/ai/index` asks a model to describe a file and embeds the answer;
-- `/api/ai/embed` embeds a search. Both are paid per call, and until now the
-- only things between a caller and the bill were per-minute limits held in a
-- function's memory (libs/server/src/rate-limit.ts): thirty descriptions a
-- minute per account, per instance, every minute of the day. The comment
-- beside that limit said the storage quota bounded the total, because a file
-- has to exist before it can be described. It did not. Describing a file again
-- overwrote its row and paid for a new description every time, so one file was
-- enough to spend without end.
--
-- A limit that bounds a bill has to be counted where every instance sees the
-- same number, which in this deployment is the database. Each call claims one
-- unit from two counters for the day: the account's and the deployment's. The
-- account's keeps one person from spending everyone's share; the deployment's
-- is the one that bounds the bill, because accounts are free to make — the
-- demo hands one to anyone who opens the site.
--
-- The limits are not stored here. The function takes them as arguments from
-- the one caller it has, `libs/server/src/ai-budget.ts`, so a deployment
-- changes them with an environment variable rather than a migration, and a
-- limit of 0 stops the spending at once without taking the keys away.
--
-- Safe to run twice.

BEGIN;

-- 1. The counters.
--
-- One row per day, per subject, per action. The subject is an account's id, or
-- '*' for the deployment as a whole; no account id is ever '*'. Days are UTC.
-- Rows are small and few (two a day for the deployment, two at most per
-- account that used the feature that day), so nothing clears them.
CREATE TABLE IF NOT EXISTS public.ai_usage (
    day     DATE    NOT NULL,
    subject TEXT    NOT NULL,
    action  TEXT    NOT NULL CHECK (action IN ('index', 'embed')),
    calls   INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0),
    PRIMARY KEY (day, subject, action)
);

COMMENT ON TABLE public.ai_usage IS
  'Paid AI calls per day (UTC), per account and for the whole deployment (subject ''*''). Written only by claim_ai_call().';

-- No policy and no grant to any API role: the function below is the only way
-- in, and it is not one the browser can call. RLS is on so that a grant added
-- by mistake later still finds nothing to show.
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage FROM PUBLIC, anon, authenticated, service_role;

-- 2. The claim.
--
-- Answers 'ok' and counts the call, or answers which of the two limits is
-- spent and counts nothing. A refused call costs no money, so it does not use
-- up the budget; a failed one did reach the provider, so it does.
--
-- SECURITY DEFINER because no API role can touch the table. The search_path is
-- pinned for the reason 009 gives.
CREATE OR REPLACE FUNCTION public.claim_ai_call(
    p_user        UUID,
    p_action      TEXT,
    p_user_limit  INTEGER,
    p_total_limit INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_day   DATE := (now() AT TIME ZONE 'utc')::date;
    v_total INTEGER;
    v_user  INTEGER;
BEGIN
    -- The deployment's row first and the account's second, in every statement
    -- below. Two claims that take the same locks in the same order wait for
    -- each other; in opposite orders they can deadlock.
    INSERT INTO public.ai_usage (day, subject, action) VALUES (v_day, '*', p_action)
    ON CONFLICT DO NOTHING;
    INSERT INTO public.ai_usage (day, subject, action) VALUES (v_day, p_user::text, p_action)
    ON CONFLICT DO NOTHING;

    -- FOR UPDATE is what makes the limit hold under concurrency: a second
    -- claim waits here until the first has counted, and then reads its count.
    SELECT calls INTO v_total FROM public.ai_usage
     WHERE day = v_day AND subject = '*' AND action = p_action
       FOR UPDATE;
    SELECT calls INTO v_user FROM public.ai_usage
     WHERE day = v_day AND subject = p_user::text AND action = p_action
       FOR UPDATE;

    IF v_total >= p_total_limit THEN
        RETURN 'deployment';
    END IF;
    IF v_user >= p_user_limit THEN
        RETURN 'account';
    END IF;

    UPDATE public.ai_usage SET calls = calls + 1
     WHERE day = v_day AND action = p_action AND subject IN ('*', p_user::text);

    RETURN 'ok';
END;
$$;

COMMENT ON FUNCTION public.claim_ai_call(UUID, TEXT, INTEGER, INTEGER) IS
  'Claims one paid AI call for an account: ''ok'' and counted, or ''account'' / ''deployment'' for the limit that is spent.';

-- For the server and no one else. A signed-in browser that could call this
-- could pass limits of its own; one that could read the table could learn how
-- much everyone else searched.
REVOKE ALL ON FUNCTION public.claim_ai_call(UUID, TEXT, INTEGER, INTEGER)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_call(UUID, TEXT, INTEGER, INTEGER) TO service_role;

COMMIT;

-- Verify — expects RLS on, no grant on the table, and EXECUTE for
-- service_role alone besides the owner:
--
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ai_usage'::regclass;
--
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_schema = 'public' AND table_name = 'ai_usage';
--
--   SELECT proacl, prosecdef, proconfig FROM pg_proc
--   WHERE pronamespace = 'public'::regnamespace AND proname = 'claim_ai_call';
--
-- And that it counts and refuses, inside a transaction that rolls back:
--
--   BEGIN;
--   SELECT public.claim_ai_call('00000000-0000-0000-0000-000000000001', 'index', 2, 3); -- ok
--   SELECT public.claim_ai_call('00000000-0000-0000-0000-000000000001', 'index', 2, 3); -- ok
--   SELECT public.claim_ai_call('00000000-0000-0000-0000-000000000001', 'index', 2, 3); -- account
--   SELECT public.claim_ai_call('00000000-0000-0000-0000-000000000002', 'index', 2, 3); -- ok
--   SELECT public.claim_ai_call('00000000-0000-0000-0000-000000000003', 'index', 2, 3); -- deployment
--   ROLLBACK;
