-- Migration: a demo account stores 10 MB, and no more than 20 of them exist
-- Run this in Supabase SQL Editor, after 018.
--
-- `/api/demo/session` opens an account for anyone who asks, with no address
-- behind it, and the account had the Free plan's 500 MB: 500 MB of hosting a
-- day for whoever opened the site. Setting a smaller limit where the account
-- is made would not have held. The Stripe webhook writes the limit of every
-- plan change, and on test keys the plans page gives the card that pays for
-- Pro: a demo account would have had 5 GB for the day instead.
--
-- So the database holds it, as it holds the quota itself (decision 0004). A
-- profile whose address is a demo address gets at most 10 MB, on the insert
-- that creates it and on every update that sets its limit. The rest of a
-- plan, its tier, its providers and its subscription, is written as the
-- webhook writes it, so a demo still shows a checkout from end to end.
--
-- A limit on each account bounds none of them together. The route lets one
-- address open 20 accounts an hour, its counter lives in one instance's
-- memory, and an account lives a day: one address would fill the 1 GB of
-- storage the whole project has on Supabase's free plan, real users' files
-- included, in five hours. So the database also refuses a demo profile
-- while 20 exist: 200 MB at most, whoever opens them and from where.
-- The route answers the refusal by erasing the oldest demo account once it is
-- an hour old and asking again, and with 503 while none is; its sweep frees a
-- place as an account ages out.
--
-- A demo address is the whole address libs/server/src/demo.ts makes:
-- `demo-`, digits, a dash, lowercase letters and digits, `@example.com`.
-- example.com takes no mail, so no account on it can be confirmed, and
-- Google issues none. A profile's address is written by the server alone
-- (decision 0002). A test holds the pattern and both numbers to demo.ts.
--
-- Safe to run twice.

BEGIN;

-- 1. What a demo account stores.
--
-- The function sees only rows the trigger's WHEN lets through, and touches
-- nothing but the row it is handed.
CREATE OR REPLACE FUNCTION public.hold_demo_storage_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.storage_limit := LEAST(NEW.storage_limit, 10485760);
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.hold_demo_storage_limit() IS
  'Holds the storage limit of a demo account to 10 MB, whatever writes it. See migrations/019.';

-- A trigger fires its function whoever holds EXECUTE; nobody needs to call
-- this one by hand.
REVOKE ALL ON FUNCTION public.hold_demo_storage_limit() FROM PUBLIC, anon, authenticated;

-- Where it applies: a new profile, and an update that names the limit.
-- `UPDATE OF storage_limit` leaves alone the updates the quota makes to
-- `bytes_used`, which are most of them.
DROP TRIGGER IF EXISTS hold_demo_storage_limit ON public.profiles;
CREATE TRIGGER hold_demo_storage_limit
    BEFORE INSERT OR UPDATE OF storage_limit ON public.profiles
    FOR EACH ROW
    WHEN (NEW.email ~ '^demo-\d+-[a-z0-9]*@example\.com$')
    EXECUTE FUNCTION public.hold_demo_storage_limit();

-- 2. How many demo accounts there are.
--
-- Counted under a lock, so two accounts made at once cannot both find the
-- last place: the second waits for the first to commit, and counts it. The
-- lock is the transaction's, released with it, and only a demo profile's
-- insert takes it. The profile is written inside the transaction that
-- creates the user (`handle_new_user`, migration 001), so a refusal here
-- leaves no user behind.
--
-- SECURITY DEFINER because the count has to see every demo profile,
-- whichever role inserted this one.
CREATE OR REPLACE FUNCTION public.refuse_demo_beyond_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('public.refuse_demo_beyond_limit'));

    IF (SELECT count(*) FROM public.profiles
         WHERE email ~ '^demo-\d+-[a-z0-9]*@example\.com$') >= 20 THEN
        RAISE EXCEPTION 'The demo is full: 20 demo accounts exist';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.refuse_demo_beyond_limit() IS
  'Refuses a demo profile while 20 exist. See migrations/019.';

REVOKE ALL ON FUNCTION public.refuse_demo_beyond_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS refuse_demo_beyond_limit ON public.profiles;
CREATE TRIGGER refuse_demo_beyond_limit
    BEFORE INSERT ON public.profiles
    FOR EACH ROW
    WHEN (NEW.email ~ '^demo-\d+-[a-z0-9]*@example\.com$')
    EXECUTE FUNCTION public.refuse_demo_beyond_limit();

-- 3. The demo accounts there are now. Their number is left as it is: the
--    sweep takes each once it is a day old.
UPDATE public.profiles
   SET storage_limit = 10485760
 WHERE email ~ '^demo-\d+-[a-z0-9]*@example\.com$'
   AND storage_limit > 10485760;

COMMIT;

-- Verify — expects both triggers, and a demo profile held to 10 MB while any
-- other keeps what it is given, inside a transaction that rolls back:
--
--   SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
--   WHERE tgrelid = 'public.profiles'::regclass
--     AND tgname IN ('hold_demo_storage_limit', 'refuse_demo_beyond_limit');
--
--   BEGIN;
--   UPDATE public.profiles SET email = 'demo-1-a@example.com', storage_limit = 5368709120
--    WHERE id = (SELECT id FROM public.profiles LIMIT 1) RETURNING storage_limit;  -- 10485760
--   ROLLBACK;
