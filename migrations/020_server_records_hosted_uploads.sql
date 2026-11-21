-- Migration: the size of a hosted file is the provider's, not the browser's
-- Run this in Supabase SQL Editor, after 019, and only once the deployment
-- that confirms uploads (/api/cloudinary/confirm, /api/r2/confirm) is live:
-- before it, the app writes those rows from the browser, and 2 refuses them.
--
-- The quota trigger from 007 counts `files.size`, and the browser wrote it.
-- 018 closed what a written row can turn into; it left what a new row may
-- say, and wrote so: "an INSERT can still state a size smaller than the
-- object it records". An account could store 40 MB and record one kilobyte.
-- See docs/decisions/0017-the-server-weighs-an-upload.md.
--
-- Two things, one for each way a hosted file arrives:
--
--   1. Supabase Storage is a bucket this database can see. When a row for it
--      is written, the size comes from the object at its path, whoever wrote
--      the row, and a row with no object behind it is refused. The path has
--      to lie in the owner's own folder: the object's `owner_id` cannot say
--      so, because the demo seed stores its files with the service role and
--      they have none (14 of the 20 rows on production on 2026-11-20).
--   2. Cloudinary and R2 are not visible from here. Their rows are written by
--      the function that confirms the upload, which asks the provider what it
--      holds; a signed-in browser may no longer insert one. A restrictive
--      policy, so the policy from 000 keeps saying whose row it is and this
--      one adds what kind of row a browser may write.
--
-- Checked against production before writing: every supabase_storage row has
-- its object, the object's `metadata.size` equals the row's size, and its
-- path starts with the owner's id (20 of 20).
--
-- Not here: bytes stored with no row at all, which nothing counts. They are
-- for the nightly reconciliation that follows this.
--
-- Safe to run twice.

BEGIN;

-- 1. The size from the object.
--
-- BEFORE INSERT, and named so that it runs before `on_file_written` (007):
-- Postgres fires the triggers of one event in the order of their names, and
-- the quota has to count the size this one sets. SECURITY DEFINER because the
-- service role's inserts need it as much as the browser's, and an empty
-- search_path so that nothing a caller creates is resolved in its place.
CREATE OR REPLACE FUNCTION public.weigh_stored_file()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_size BIGINT;
BEGIN
    IF NEW.storage_type = 'supabase_storage' THEN
        IF split_part(NEW.storage_path, '/', 1) <> NEW.user_id::text THEN
            RAISE EXCEPTION USING
                ERRCODE = 'PT403',
                MESSAGE = 'a stored file lies in its owner''s own folder';
        END IF;

        SELECT (o.metadata ->> 'size')::bigint
          INTO v_size
          FROM storage.objects AS o
         WHERE o.bucket_id = 'files'
           AND o.name = NEW.storage_path;

        IF v_size IS NULL THEN
            RAISE EXCEPTION USING
                ERRCODE = 'PT404',
                MESSAGE = 'no stored object at this path';
        END IF;

        NEW.size := v_size;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.weigh_stored_file() FROM PUBLIC;

DROP TRIGGER IF EXISTS on_file_weighed ON public.files;
CREATE TRIGGER on_file_weighed
    BEFORE INSERT ON public.files
    FOR EACH ROW EXECUTE FUNCTION public.weigh_stored_file();

-- 2. What a browser may insert. The same list as SERVER_RECORDED in
-- libs/core/src/file-rules.ts, the other way round; file-rules.test.ts holds
-- the two together.
DROP POLICY IF EXISTS "Hosted uploads are recorded by the server" ON public.files;
CREATE POLICY "Hosted uploads are recorded by the server" ON public.files
    AS RESTRICTIVE
    FOR INSERT TO authenticated
    WITH CHECK (storage_type IN ('supabase_storage', 'googledrive', 'dropbox'));

COMMIT;

-- Verify — expects the two triggers, on_file_weighed first, and the
-- restrictive policy beside the one from 000:
--
--   SELECT tgname FROM pg_trigger
--   WHERE tgrelid = 'public.files'::regclass AND NOT tgisinternal
--   ORDER BY tgname;
--
--   SELECT polname, polpermissive, polcmd, pg_get_expr(polwithcheck, polrelid)
--   FROM pg_policy WHERE polrelid = 'public.files'::regclass;
--
-- Probe — as an account with a stored file, inside a transaction that rolls
-- back (the ids are that account's):
--
--   BEGIN;
--   SET LOCAL ROLE authenticated;
--   SELECT set_config('request.jwt.claims', '{"sub":"<user id>"}', true);
--   INSERT INTO public.files (name, size, type, download_url, storage_path, storage_type, user_id)
--   VALUES ('probe', 1, 'text/plain', 'https://example.com', '<user id>/<object>', 'supabase_storage', '<user id>')
--   RETURNING size;                     -- the object's size, not 1
--   INSERT INTO public.files (name, size, type, download_url, storage_path, storage_type, user_id)
--   VALUES ('probe', 1, 'image/png', 'https://example.com', 'users/<user id>/x', 'cloudinary', '<user id>');
--                                       -- refused by the restrictive policy
--   ROLLBACK;
