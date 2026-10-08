-- Migration: refuse a storage_path that a URL parser would rewrite
-- Run this in Supabase SQL Editor.
--
-- 013 bound `files.storage_path` to the row owner's prefix: `users/<id>/` for
-- R2 and Cloudinary, `<id>/` for Supabase Storage. A prefix is a check on the
-- characters at the front of a string, and the routes that act on the path turn
-- it into a URL. A browser rewrites a URL before it fetches it: it resolves `..`
-- segments, reads `\` as `/`, decodes `%2e` to `.`, and drops tabs and newlines
-- first of all. So `users/<id>/../<other>/x` starts with the owner's prefix
-- and can name `<other>`'s object by the time anyone fetches it. Whether a
-- given signer and storage would let that through was never established. This
-- makes the question moot instead.
--
-- No path this app creates contains any of it. The upload routes put a
-- timestamp in front of a name that has been sanitised (`libs/server/src/filename.ts`,
-- `src/services/supabase-storage.service.ts`, `libs/server/src/demo.ts`), and Cloudinary
-- picks its own public ids inside the folder. `?` and `#` are refused with the
-- rest, because a URL ends its path at either one.
--
-- The rule is `ownsStoredPath` in libs/core/src/stored-path.ts. A change to one is a
-- change to both, and to 013.
--
-- A constraint of its own rather than a wider 013, so that a refusal names
-- which rule failed: the path belongs to someone else, or it does not say
-- plainly which object it is.
--
-- Checked against production on 2026-10-04 before writing it: every hosted row
-- passes, 37 of 37 (27 Supabase Storage, 10 Cloudinary, none in R2). As with
-- 013, `NOT VALID` is not used, because there is nothing to grandfather in.
--
-- Applied to production on 2026-10-04, after the pre-flight below came back
-- empty (37 hosted rows). The constraint went in validated. It was then probed
-- with the statement at the foot of this file, inside transactions that were
-- rolled back. A path under the owner's own prefix that climbs out with `..`
-- was refused with 23514 by this constraint. A plain path under the same
-- prefix went in. No probe row was left behind. The Playwright suite then ran
-- against production with the constraint in place, 39 of 39, and in CI, which
-- uses the same database, 43 of 43.
-- Safe to run twice: the DROP ... IF EXISTS comes first.
--
-- Pre-flight — expects no rows:
--
--   SELECT storage_type, count(*)
--   FROM public.files
--   WHERE storage_type IN ('r2', 'cloudinary', 'supabase_storage')
--     AND (storage_path ~ '[\\%?#[:cntrl:]]' OR storage_path ~ '(^|/)\.\.?(/|$)')
--   GROUP BY storage_type;

BEGIN;

ALTER TABLE public.files
  DROP CONSTRAINT IF EXISTS files_storage_path_is_plain;

ALTER TABLE public.files
  ADD CONSTRAINT files_storage_path_is_plain
  CHECK (
    storage_type NOT IN ('r2', 'cloudinary', 'supabase_storage')
    OR (
      storage_path !~ '[\\%?#[:cntrl:]]'
      AND storage_path !~ '(^|/)\.\.?(/|$)'
    )
  );

COMMENT ON CONSTRAINT files_storage_path_is_plain ON public.files IS
  'A URL parser must not be able to read this path as naming another object: no . or .. segments, no backslash, %, ?, # or control characters.';

COMMIT;

-- Verify by trying to break it, as with 013: a path under the owner's own
-- prefix that climbs out of it must be refused with 23514, and a plain one
-- must go in. Inside a transaction that is rolled back, against a real
-- account so the quota trigger has a profile to read:
--
--   BEGIN;
--   INSERT INTO public.files (name, size, type, download_url, storage_path, storage_type, user_id)
--   SELECT 'probe', 1, 'text/plain', 'https://example.invalid/',
--          id::text || '/../someone-else/probe', 'supabase_storage', id
--   FROM auth.users LIMIT 1;
--   ROLLBACK;
