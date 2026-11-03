-- Migration: what a file row may say, and what a browser may change in one
-- Run this in Supabase SQL Editor, after 017.
--
-- `files` and `folders` rows are written by the browser. Their policies decide
-- whose row it is, and nothing decided what a row may say — while the quota
-- trigger from 007 believes what it says. Measured on production on 2026-11-01,
-- inside a transaction that rolled back, as an account with no files:
--
--   a row of 300 MB                          bytes_used 300 000 000
--   UPDATE files SET size = 0                bytes_used 0
--   size back to 300 MB, provider googledrive bytes_used 0
--   a row of -5 GB                           accepted, bytes_used 0
--
-- The bytes stay in the bucket throughout. And a folder was created under
-- another account's folder, with a file filed into it: a foreign key does not
-- consult RLS, and deleting that folder would have cascaded into this
-- account's rows from the other one's.
--
-- Five things, each for one of those:
--
--   1. CHECKs. A size is not negative, a provider is one the app has, and the
--      text columns have lengths a person or a provider produces.
--   2. Column grants. A signed-in account may change a row's name and nothing
--      else. 001 and 002 say that RLS has no column granularity, which is why
--      billing is server-write only; GRANT has it. The app renames, and does
--      nothing else to a row it has written: there is no move. When one comes,
--      `folder_id` and `parent_id` join the grant, and 3 already holds them to
--      the owner.
--   3. A folder's parent, and a file's folder, belong to the row's own account.
--   4. A Storage upload lands directly in the owner's folder, not deeper. The
--      account erase lists that folder one level down
--      (libs/server/src/account-erase.ts): a nested object outlived its
--      account, and a hundred nested folders kept the erase looping until the
--      function timed out.
--   5. The bucket refuses a file over 50 MB, the most the Free plan accepts.
--      It said nothing at all before (`file_size_limit` was null).
--
-- Not here: an INSERT can still state a size smaller than the object it
-- records. A row stays the browser's to write until uploads are confirmed by
-- the server; this closes what a written row can turn into.
--
-- Checked against production before writing: names of at most 37 characters,
-- types 15, paths 85, addresses 499; providers cloudinary and
-- supabase_storage; sizes from 257 bytes; nothing filed under another
-- account's folder; no object over 50 MB, and none below the owner's folder.
--
-- Safe to run twice.

BEGIN;

-- 1. What a row may say.
--
-- The provider list and the name limit are written in
-- libs/core/src/file-rules.ts as well, which the browser checks before it
-- writes; libs/core/src/file-rules.test.ts holds the two copies together.
-- The other ceilings bound what a row can hold rather than describe it: a type
-- is a MIME type, a path an object key (S3 and R2 allow 1,024 bytes), and an
-- address a delivery link or a signed URL.
ALTER TABLE public.files
  DROP CONSTRAINT IF EXISTS files_size_not_negative,
  DROP CONSTRAINT IF EXISTS files_storage_type_known,
  DROP CONSTRAINT IF EXISTS files_name_length,
  DROP CONSTRAINT IF EXISTS files_text_lengths;

ALTER TABLE public.files
  ADD CONSTRAINT files_size_not_negative CHECK (size >= 0),
  ADD CONSTRAINT files_storage_type_known
    CHECK (storage_type IN ('cloudinary', 'r2', 'supabase_storage', 'googledrive', 'dropbox')),
  ADD CONSTRAINT files_name_length CHECK (char_length(name) BETWEEN 1 AND 255),
  ADD CONSTRAINT files_text_lengths CHECK (
    char_length(type) <= 255
    AND char_length(storage_path) <= 1024
    AND char_length(download_url) <= 4096
  );

ALTER TABLE public.folders
  DROP CONSTRAINT IF EXISTS folders_name_length;

ALTER TABLE public.folders
  ADD CONSTRAINT folders_name_length CHECK (char_length(name) BETWEEN 1 AND 255);

-- 2. What a signed-in account may change once a row is written: its name.
--
-- REVOKE then GRANT, because a table-wide UPDATE covers every column and a
-- column grant beside it would take nothing away. service_role keeps the
-- table-wide grant 016 gave it.
REVOKE UPDATE ON public.files FROM authenticated;
GRANT UPDATE (name) ON public.files TO authenticated;

REVOKE UPDATE ON public.folders FROM authenticated;
GRANT UPDATE (name) ON public.folders TO authenticated;

-- 3. A parent, and a folder, of the row's own account.
--
-- The same foreign keys with the owner added to both sides, which needs
-- (id, user_id) to be unique on folders: it is, since id is, but a foreign key
-- has to point at a constraint that says so. A row with no parent or no folder
-- is not checked, as before. The foreign keys go first and come back last, so
-- that the second run of this file can replace the constraint they rest on.
ALTER TABLE public.files
  DROP CONSTRAINT IF EXISTS files_folder_id_fkey,
  DROP CONSTRAINT IF EXISTS files_folder_is_owners;

ALTER TABLE public.folders
  DROP CONSTRAINT IF EXISTS folders_parent_id_fkey,
  DROP CONSTRAINT IF EXISTS folders_parent_is_owners;

ALTER TABLE public.folders
  DROP CONSTRAINT IF EXISTS folders_id_user_id_key;

ALTER TABLE public.folders
  ADD CONSTRAINT folders_id_user_id_key UNIQUE (id, user_id);

ALTER TABLE public.folders
  ADD CONSTRAINT folders_parent_is_owners
  FOREIGN KEY (parent_id, user_id) REFERENCES public.folders (id, user_id) ON DELETE CASCADE;

ALTER TABLE public.files
  ADD CONSTRAINT files_folder_is_owners
  FOREIGN KEY (folder_id, user_id) REFERENCES public.folders (id, user_id) ON DELETE CASCADE;

-- 4. An upload lands in the owner's folder itself.
--
-- `{userId}/{timestamp}_{name}` is the one shape the app writes, in
-- supabase-storage.service.ts and in the demo seed, and its folder is one
-- segment long. Reading and deleting keep their policies from 006: an object
-- written deeper before this, of which production has none, can still be
-- read and removed.
DROP POLICY IF EXISTS "Users can upload their own files" ON storage.objects;
CREATE POLICY "Users can upload their own files" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'files'
        AND ((storage.foldername(name))[1])::uuid = auth.uid()
        AND array_length(storage.foldername(name), 1) = 1
    );

-- 5. The bucket's own ceiling: 50 MB.
UPDATE storage.buckets SET file_size_limit = 52428800 WHERE id = 'files';

COMMIT;

-- Verify — expects the four CHECKs on files and one on folders, the two
-- foreign keys with the owner in them, and UPDATE (name) for authenticated:
--
--   SELECT conrelid::regclass, conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE connamespace = 'public'::regnamespace
--     AND conname IN ('files_size_not_negative', 'files_storage_type_known',
--                     'files_name_length', 'files_text_lengths', 'folders_name_length',
--                     'folders_parent_is_owners', 'files_folder_is_owners');
--
--   SELECT table_name, column_name, privilege_type
--   FROM information_schema.column_privileges
--   WHERE table_schema = 'public' AND grantee = 'authenticated'
--     AND privilege_type = 'UPDATE';
--
-- And that each one bites, as a signed-in account, inside a transaction that
-- rolls back (each statement must fail):
--
--   UPDATE files SET size = 0 WHERE id = '<a file of the account>';          -- 42501
--   INSERT INTO files (..., size, ...) VALUES (..., -1, ...);                -- 23514
--   INSERT INTO folders (name, parent_id, user_id)
--     VALUES ('x', '<another account''s folder>', '<the account>');          -- 23503
