-- Migration: constrain files.download_url to http(s)
-- Run this in Supabase SQL Editor.
--
-- `files` rows are written by the browser. The policy on the table is
-- `FOR ALL USING (auth.uid() = user_id)`, which is correct — it stops one
-- account touching another's rows — but it says nothing about what an account
-- may put in its own. Nothing else did either:
--
--   * `FileMetadataSchema` had `.url()` removed, with a comment saying the check
--     was rejecting long signed URLs. It ran in the browser regardless, which
--     is not a place a validation can be enforced from;
--   * no CHECK constraint on the column;
--   * `api/share.ts` returned the stored value verbatim for every provider that
--     keeps a delivery URL rather than a private object — Cloudinary, Google
--     Drive and Dropbox.
--
-- So a `javascript:` URL written into one's own row and then shared through
-- `/s/<token>` became the href of the Download button on `SharedFile.tsx`, in
-- the recipient's session, on this origin. The CSP does not stop that:
-- `script-src` carries 'unsafe-inline', and that directive is what governs
-- `javascript:` URLs.
--
-- Fixed in three places, of which this is the one that cannot be bypassed —
-- the other two are code paths, and a code path can gain a second entrance:
--
--   1. `api/share.ts` refuses to return a value that is not http(s);
--   2. `FileMetadataSchema` refuses to build one, as a scheme allowlist rather
--      than the `.url()` that was too strict for signed URLs;
--   3. this constraint, which is the only one PostgREST cannot be talked past.
--
-- Checked against production before writing it: all 20 rows are `https`, so
-- nothing legitimate is rejected and the constraint validates without a
-- rewrite. `NOT VALID` is deliberately *not* used for that reason — there is
-- nothing to grandfather in.
--
-- Applied to production on 2026-09-06. Safe to run twice — the DROP ... IF
-- EXISTS above is there for exactly that.
--
-- Verified by trying to break it: an INSERT carrying `javascript:alert(1)` was
-- refused with 23514 on the live database. All 20 existing rows were `https`,
-- checked immediately before applying, so the constraint validated without a
-- rewrite and nothing legitimate was rejected.

BEGIN;

ALTER TABLE public.files
  DROP CONSTRAINT IF EXISTS files_download_url_is_http;

-- `~*` rather than a function: the check has to hold for every writer,
-- including psql and the dashboard, and a regex anchored at the start is the
-- whole question. Schemes are case-insensitive per RFC 3986.
ALTER TABLE public.files
  ADD CONSTRAINT files_download_url_is_http
  CHECK (download_url ~* '^https?://');

COMMENT ON CONSTRAINT files_download_url_is_http ON public.files IS
  'A stored location becomes an href on the public share page. Anything but http(s) is script.';

COMMIT;

-- Verify — expects one row:
--
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'public.files'::regclass
--     AND conname = 'files_download_url_is_http';
--
-- And that it bites. This must fail with 23514:
--
--   INSERT INTO public.files (user_id, name, size, type, download_url,
--                             storage_path, storage_type)
--   VALUES ('00000000-0000-0000-0000-000000000000', 'x', 1, 'text/plain',
--           'javascript:alert(1)', 'x', 'cloudinary');
