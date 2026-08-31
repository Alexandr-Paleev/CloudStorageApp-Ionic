-- Migration: enforce the storage quota in the database
--
-- Until now the only place a server checked the quota was
-- api/r2/presign-upload.ts. That covers one provider out of three, and not the
-- ones production actually uses: images go to Cloudinary through an unsigned
-- upload preset straight from the browser, and everything else went to
-- Supabase Storage through supabase-js with the anon key. Neither path passes
-- through code we control, so on both of them the limit was held up by
-- canUploadToLocal() in the client — that is, by the client's good manners.
--
-- Even on the R2 path the check was check-then-act: two parallel requests both
-- read the same total, both passed, both got a URL.
--
-- The fix puts the check where it cannot be walked around. A file exists in
-- this app only once its row lands in public.files, whichever bucket holds the
-- bytes, so the row is the chokepoint:
--
--   * profiles.bytes_used is maintained by a trigger, not recomputed by
--     summing every row on each upload (which both the API and the client
--     were doing, separately, on every single upload);
--   * the same trigger refuses an INSERT that would cross storage_limit;
--   * it takes a row lock on the profile first, so two concurrent uploads
--     serialise and the second one sees the first one's bytes.
--
-- A rejected INSERT leaves the uploaded object orphaned in the bucket for a
-- moment, and that is already handled: storage.service.uploadFile() deletes it
-- when the metadata write fails.
--
-- Safe to run twice.

-- 1. The counter.
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS bytes_used BIGINT NOT NULL DEFAULT 0;

-- 2. The gate, and the counter's only writer.
--
-- SECURITY DEFINER because UPDATE on profiles is revoked from authenticated
-- (see 001 and 002: RLS has no column-level granularity, so a user who could
-- write to this table could set their own tier). The function updates exactly
-- one column of exactly one row, and derives the row from the file being
-- written rather than from anything the caller says.
CREATE OR REPLACE FUNCTION public.enforce_storage_quota()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user  UUID;
    v_delta BIGINT;
    v_limit BIGINT;
    v_used  BIGINT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_user := NEW.user_id;
        v_delta := NEW.size;
    ELSIF TG_OP = 'DELETE' THEN
        v_user := OLD.user_id;
        v_delta := -OLD.size;
    ELSE
        -- Moving a file between accounts would make both counters wrong, and
        -- nothing in the app does it.
        IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
            RAISE EXCEPTION 'a file cannot change owner';
        END IF;
        v_user := NEW.user_id;
        v_delta := NEW.size - OLD.size;
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

    IF v_delta > 0 AND v_used + v_delta > v_limit THEN
        -- 53100 is disk_full: the client can recognise it without matching on
        -- the message text. supabase-js surfaces it as error.code.
        RAISE EXCEPTION USING
            ERRCODE = '53100',
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

DROP TRIGGER IF EXISTS on_file_written ON public.files;
CREATE TRIGGER on_file_written
    BEFORE INSERT OR UPDATE OR DELETE ON public.files
    FOR EACH ROW EXECUTE FUNCTION public.enforce_storage_quota();

-- 3. Recount from the rows themselves.
--
-- Also the repair tool: the counter is a cache of a sum, and a cache that
-- cannot be rebuilt is a liability. Runs on every migration run, which is why
-- this file is safe to re-run.
CREATE OR REPLACE FUNCTION public.recount_storage_used()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    UPDATE public.profiles p
       SET bytes_used = COALESCE(t.total, 0)
      FROM (SELECT id FROM public.profiles) ids
      LEFT JOIN (
          SELECT user_id, SUM(size) AS total
            FROM public.files
           GROUP BY user_id
      ) t ON t.user_id = ids.id
     WHERE p.id = ids.id
       AND p.bytes_used IS DISTINCT FROM COALESCE(t.total, 0);
$$;

REVOKE ALL ON FUNCTION public.recount_storage_used() FROM PUBLIC, anon, authenticated;

SELECT public.recount_storage_used();
