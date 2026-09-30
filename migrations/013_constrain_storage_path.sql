-- Migration: constrain files.storage_path to the row owner's own storage
-- Run this in Supabase SQL Editor.
--
-- `files` rows are written by the browser. The policy on the table,
-- `FOR ALL USING (auth.uid() = user_id)`, decides which rows an account may
-- write and says nothing about what it may put in them. 010 made that point
-- about `download_url`; this is the same point about the column beside it.
--
-- `storage_path` names an object, and two routes acted on that name with this
-- deployment's own credentials, which do not care whose object it is:
--
--   * `/api/share` signed it — with the service-role key for Supabase Storage
--     and the R2 keys for R2 — for anyone holding a link to the row. A row of
--     one's own pointing at another account's object was a link to that
--     object. And every recipient reads the path in the signed URL they are
--     handed, so a revoked or expired link could be replaced by a fresh one.
--   * `/api/cloudinary/delete`, for a public_id outside the caller's folder,
--     fell back to asking whether the caller had a row naming it — which is
--     proof the caller can write for themselves. Public ids are in every
--     delivery URL.
--
-- Both are fixed in code in the same change: the share route checks the path
-- against the row owner's prefix before signing (`ownsStoredPath`, the check
-- the indexer already made), and the delete route decides by the folder alone.
-- This constraint is the version of that check PostgREST cannot be talked
-- past. The code paths are two today, and a code path can gain a second
-- entrance.
--
-- The prefixes are the ones the upload routes create: `users/<id>/` for R2 and
-- Cloudinary, `<id>/` for Supabase Storage. Google Drive and Dropbox are left
-- alone on purpose: their path is an id in the user's own account, reached
-- with the user's own OAuth grant and never with this app's credentials. The
-- rule is `ownsStoredPath` in lib/ai.ts; a change to one is a change to both.
--
-- `starts_with` rather than LIKE, which reads `_` as a wildcard. A UUID has
-- no `_` in it, but the function says what is meant.
--
-- Checked against production on 2026-09-29, before writing it: every row
-- passes — 20 of 20 at the time, 10 Cloudinary and 10 Supabase Storage, none
-- in R2. `NOT VALID` is deliberately not used, as in 010: there is nothing to
-- grandfather in. If the pre-flight below does find a row, look at it before
-- reaching for NOT VALID — it is either a bug or the thing this is for.
--
-- Applied to production on 2026-09-30, after the pre-flight below came back
-- empty (16 rows then: 10 Cloudinary, 6 Supabase Storage). Verified by trying
-- to break it, with the probe at the foot of this file: a row naming somebody
-- else's object was refused with 23514 and a row under the owner's own prefix
-- went in, both rolled back. The Playwright suite then ran against the live
-- database with the constraint in place — 36 of 36 in the chromium project.
-- Safe to run twice: the DROP ... IF EXISTS comes first.
--
-- Pre-flight — expects no rows:
--
--   SELECT storage_type, count(*)
--   FROM public.files
--   WHERE NOT CASE
--     WHEN storage_type IN ('r2', 'cloudinary')
--       THEN starts_with(storage_path, 'users/' || user_id::text || '/')
--     WHEN storage_type = 'supabase_storage'
--       THEN starts_with(storage_path, user_id::text || '/')
--     ELSE true
--   END
--   GROUP BY storage_type;

BEGIN;

ALTER TABLE public.files
  DROP CONSTRAINT IF EXISTS files_storage_path_is_owners;

ALTER TABLE public.files
  ADD CONSTRAINT files_storage_path_is_owners
  CHECK (
    CASE
      WHEN storage_type IN ('r2', 'cloudinary')
        THEN starts_with(storage_path, 'users/' || user_id::text || '/')
      WHEN storage_type = 'supabase_storage'
        THEN starts_with(storage_path, user_id::text || '/')
      ELSE true
    END
  );

COMMENT ON CONSTRAINT files_storage_path_is_owners ON public.files IS
  'The server signs and deletes by this path with its own credentials, so it must name the row owner''s own object.';

COMMIT;

-- Verify by trying to break it, as 010 was: a row naming somebody else's
-- object must be refused with 23514. Inside a transaction that is rolled back,
-- against a real account so the quota trigger has a profile to read:
--
--   BEGIN;
--   INSERT INTO public.files (name, size, type, download_url, storage_path, storage_type, user_id)
--   SELECT 'probe', 1, 'text/plain', 'https://example.invalid/', 'someone-else/probe',
--          'supabase_storage', id
--   FROM auth.users LIMIT 1;
--   ROLLBACK;
--
-- And the part a constraint cannot answer: that uploads still land. The e2e
-- suite seeds rows under the owner's prefix (`e2e/fixtures.ts`,
-- `e2e/quota.spec.ts`) and uploads through every provider the deployment has.
