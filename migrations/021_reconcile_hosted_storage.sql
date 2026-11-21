-- Migration: the nightly reconciliation of hosted storage
-- Run this in Supabase SQL Editor, after 020. It may go before or after the
-- deployment that calls it: nothing in the app uses these functions but
-- /api/account/reconcile, and the one change to the quota trigger only stops
-- it refusing an UPDATE that the browser cannot make.
--
-- 020 made the size of a new hosted row the provider's. It left three things,
-- and named them: bytes stored with no row, which nothing counts; a Storage or
-- Cloudinary object deleted and replaced at the same path after its row was
-- written, so that the row keeps the first size; and the counter in
-- `profiles.bytes_used`, which only the trigger moves and nothing checks.
-- See docs/decisions/0018-a-nightly-reconciliation.md.
--
-- The work is done by /api/account/reconcile, once a day. This file gives it
-- what only the database can do:
--
--   1. The quota trigger stops refusing an UPDATE. The browser may change a
--      row's name and nothing else (018), so the only UPDATE that changes a
--      size is the reconciliation's, and it writes what the provider holds.
--   2. One query over the Storage bucket: objects with no row, rows whose
--      size is not their object's, rows with no object.
--   3. A recount of `bytes_used` that locks each profile before it counts.
--      007's `recount_storage_used()` is one UPDATE with no lock: an upload
--      committed while it runs is counted by the trigger and then overwritten
--      by a sum that did not see it.
--
-- Checked on production before writing (2026-11-21): 36 objects in the bucket,
-- 8 with no row (all from deleted e2e accounts, 3.5 KB), no row whose size
-- differs from its object, `bytes_used` equal to the sum of its rows for all
-- 12 profiles.
--
-- Safe to run twice.

BEGIN;

-- 1. The quota trigger refuses on INSERT only. The rest of the function is
--    007's, as production has it.

CREATE OR REPLACE FUNCTION public.enforce_storage_quota()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    -- The three backends this app pays for. Google Drive and Dropbox hold the
    -- bytes in the user's own account, so they cost the plan nothing and must
    -- not be counted — counting them would also break the feature that exists
    -- for exactly this moment: when local storage is full, uploads overflow
    -- into a connected Drive. Same list as LOCAL_PROVIDERS in
    -- src/providers/ProviderManager.ts, and the reason the client-side check
    -- is called canUploadToLocal().
    HOSTED CONSTANT TEXT[] := ARRAY['cloudinary', 'r2', 'supabase_storage'];

    v_user  UUID;
    v_delta BIGINT;
    v_limit BIGINT;
    v_used  BIGINT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_user := NEW.user_id;
        v_delta := CASE WHEN NEW.storage_type = ANY (HOSTED) THEN NEW.size ELSE 0 END;
    ELSIF TG_OP = 'DELETE' THEN
        v_user := OLD.user_id;
        v_delta := -CASE WHEN OLD.storage_type = ANY (HOSTED) THEN OLD.size ELSE 0 END;
    ELSE
        -- Moving a file between accounts would make both counters wrong, and
        -- nothing in the app does it.
        IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
            RAISE EXCEPTION 'a file cannot change owner';
        END IF;
        v_user := NEW.user_id;
        v_delta := CASE WHEN NEW.storage_type = ANY (HOSTED) THEN NEW.size ELSE 0 END
                 - CASE WHEN OLD.storage_type = ANY (HOSTED) THEN OLD.size ELSE 0 END;
    END IF;

    -- A file in the user's own cloud changes nothing here: no limit to check,
    -- no counter to move, and no reason to take a lock on the profile.
    IF v_delta = 0 THEN
        RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    -- FOR UPDATE is the whole point: a second upload for the same account
    -- blocks here until the first one commits, and then reads its bytes.
    -- Without it both transactions read the same total and both fit.
    SELECT storage_limit, bytes_used
      INTO v_limit, v_used
      FROM public.profiles
     WHERE id = v_user
       FOR UPDATE;

    IF NOT FOUND THEN
        -- Rows written before profiles existed, and the demo seed's own files,
        -- have no profile to count against. Refusing here would break inserts
        -- that have nothing to do with anyone's quota.
        RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    -- On INSERT only (021). Since 018 a row's size is changed by nothing but
    -- the nightly reconciliation, which writes what the provider holds; the
    -- truth about a file must not be refused for not fitting. The account is
    -- then over its limit, and its next upload is what gets refused.
    IF TG_OP = 'INSERT' AND v_delta > 0 AND v_used + v_delta > v_limit THEN
        -- PostgREST turns a SQLSTATE of the form PTnnn into HTTP nnn, so a
        -- browser writing this row directly is refused with the same 413 that
        -- /api answers with — and supabase-js surfaces the code, so the client
        -- recognises the refusal without matching on message text.
        RAISE EXCEPTION USING
            ERRCODE = 'PT413',
            MESSAGE = format(
                'Storage limit exceeded: %s of %s bytes used, this file needs %s more',
                v_used, v_limit, v_delta
            );
    END IF;

    -- greatest() guards the counter against going negative if it ever drifts
    -- from the rows it is meant to mirror.
    UPDATE public.profiles
       SET bytes_used = GREATEST(0, bytes_used + v_delta)
     WHERE id = v_user;

    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END;
$$;


-- 2. The Storage bucket against its rows.
--
-- `orphan`: an object no row names, stored before `p_created_before`. An
-- upload writes its object first and its row a moment later, so the caller
-- passes a time a day back, and an upload in flight is never one.
-- `misweighed`: a row whose size is not its object's.
-- `missing`: a row with nothing at its path. Reported, never acted on.
--
-- At most 1000 rows of each kind; what is left is there the next night.
CREATE OR REPLACE FUNCTION public.reconcile_storage_bucket(p_created_before TIMESTAMPTZ)
RETURNS TABLE (kind TEXT, path TEXT, file_id UUID, recorded BIGINT, actual BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    (SELECT 'orphan', o.name, NULL::uuid, NULL::bigint, (o.metadata ->> 'size')::bigint
       FROM storage.objects AS o
      WHERE o.bucket_id = 'files'
        AND o.created_at < p_created_before
        AND NOT EXISTS (
            SELECT 1 FROM public.files AS f
             WHERE f.storage_type = 'supabase_storage' AND f.storage_path = o.name)
      ORDER BY o.created_at
      LIMIT 1000)
    UNION ALL
    (SELECT 'misweighed', f.storage_path, f.id, f.size, (o.metadata ->> 'size')::bigint
       FROM public.files AS f
       JOIN storage.objects AS o ON o.bucket_id = 'files' AND o.name = f.storage_path
      WHERE f.storage_type = 'supabase_storage'
        AND f.size IS DISTINCT FROM (o.metadata ->> 'size')::bigint
      ORDER BY f.created_at
      LIMIT 1000)
    UNION ALL
    (SELECT 'missing', f.storage_path, f.id, f.size, NULL::bigint
       FROM public.files AS f
      WHERE f.storage_type = 'supabase_storage'
        AND f.created_at < p_created_before
        AND NOT EXISTS (
            SELECT 1 FROM storage.objects AS o
             WHERE o.bucket_id = 'files' AND o.name = f.storage_path)
      ORDER BY f.created_at
      LIMIT 1000);
$$;

REVOKE ALL ON FUNCTION public.reconcile_storage_bucket(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_storage_bucket(TIMESTAMPTZ) TO service_role;

-- 3. `bytes_used` against the rows it mirrors.
--
-- Returns every profile whose counter is not the sum of its hosted rows, and
-- with `p_apply` sets it to that sum. Each profile is locked before it is
-- counted, the lock the trigger takes: an upload in progress either committed
-- before the lock, and the count sees it, or waits for it, and adds its size
-- to the corrected counter.
CREATE OR REPLACE FUNCTION public.reconcile_bytes_used(p_apply BOOLEAN)
RETURNS TABLE (user_id UUID, recorded BIGINT, counted BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    -- The providers the trigger counts (007), and for the same reason.
    HOSTED CONSTANT TEXT[] := ARRAY['cloudinary', 'r2', 'supabase_storage'];
    v_id UUID;
BEGIN
    FOR v_id IN
        SELECT p.id
          FROM public.profiles AS p
         WHERE p.bytes_used IS DISTINCT FROM (
               SELECT COALESCE(SUM(f.size), 0)
                 FROM public.files AS f
                WHERE f.user_id = p.id AND f.storage_type = ANY (HOSTED))
    LOOP
        user_id := v_id;
        SELECT p.bytes_used INTO recorded
          FROM public.profiles AS p
         WHERE p.id = v_id
           FOR UPDATE;
        SELECT COALESCE(SUM(f.size), 0) INTO counted
          FROM public.files AS f
         WHERE f.user_id = v_id AND f.storage_type = ANY (HOSTED);

        -- Counted again under the lock: the first look was without one.
        CONTINUE WHEN recorded IS NOT DISTINCT FROM counted;

        IF p_apply THEN
            UPDATE public.profiles SET bytes_used = counted WHERE id = v_id;
        END IF;
        RETURN NEXT;
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_bytes_used(BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_bytes_used(BOOLEAN) TO service_role;

COMMIT;

-- Verify:
--
--   SELECT p.proname, p.prosecdef, p.proconfig,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
--          has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon,
--          has_function_privilege('service_role', p.oid, 'EXECUTE')  AS service_role
--     FROM pg_proc AS p
--    WHERE p.pronamespace = 'public'::regnamespace
--      AND p.proname IN ('reconcile_storage_bucket', 'reconcile_bytes_used');
--   → both SECURITY DEFINER, search_path="", false, false, true
--
--   SELECT kind, count(*) FROM public.reconcile_storage_bucket(now() - interval '1 day') GROUP BY kind;
--   SELECT * FROM public.reconcile_bytes_used(false);
--   → what the night would act on, changing nothing
--
-- Probe the trigger in a transaction that rolls back: an UPDATE that takes a
-- full account past its limit is accepted, and an INSERT that would is not.
