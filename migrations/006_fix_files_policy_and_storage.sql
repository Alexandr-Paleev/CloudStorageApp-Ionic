-- Migration: drop a dead policy on files, and write the Storage rules down
-- Run this in Supabase SQL Editor.
--
-- Two things that lived only in the live database and in nobody's notes.
--
--
-- 1. "Anyone can view shared files" on public.files
--
-- The policy was
--
--   FOR SELECT TO public
--   USING (EXISTS (SELECT 1 FROM shared_links WHERE shared_links.file_id = files.id))
--
-- which reads: any file that has ever had a share link is readable by anyone.
-- No token. No check on expires_at. No check on revoked_at. It would hand an
-- anonymous caller name, size, user_id, storage_path and download_url for every
-- shared file — including files whose link was revoked, which is precisely the
-- promise revocation makes.
--
-- It is not currently exploitable, and the reason is worth writing down because
-- it is not obvious: the subquery inside a policy is itself subject to RLS on
-- the table it reads. Since 004 left shared_links with only
-- "created_by = auth.uid()", an anonymous caller sees no rows there, so EXISTS
-- is false for every file. Verified both ways against the live database: as
-- anon, public.files returns 0 rows; adding a permissive SELECT policy to
-- shared_links inside a rolled-back transaction made all of them visible.
--
-- So shared_links' RLS is load-bearing for the privacy of files, silently. Add
-- one natural-looking policy there later — "recipients can look up a link by
-- token" is exactly the kind of thing someone would write — and every shared
-- file leaks at once.
--
-- The policy has no consumer either way. SharedFile.tsx fetches /api/share,
-- which reads files with the service-role key and bypasses RLS; every client
-- read of files in supabase.service.ts is scoped .eq('user_id', userId). So it
-- is dropped rather than narrowed.
--
--
-- 2. The Storage rules
--
-- The bucket and its three policies were created by hand. The README says only
-- "Set up a private bucket named files in Storage", so a fresh project ends up
-- with RLS on storage.objects and no policies at all — every upload through
-- SupabaseStorageProvider fails with a permission error, for the same reason
-- shared_links was missing before 005. The definitions below are read off the
-- live database.
--
-- Safe to run twice.

DROP POLICY IF EXISTS "Anyone can view shared files" ON public.files;

-- Private on purpose: objects are served through short-lived signed URLs,
-- created in supabase-storage.service.ts and in /api/share.
INSERT INTO storage.buckets (id, name, public)
VALUES ('files', 'files', false)
ON CONFLICT (id) DO NOTHING;

-- Paths are "{userId}/{timestamp}_{fileName}", so the first path segment is the
-- owner and is what every policy below checks against auth.uid().
DROP POLICY IF EXISTS "Users can read their own files" ON storage.objects;
CREATE POLICY "Users can read their own files" ON storage.objects
    FOR SELECT TO authenticated
    USING (bucket_id = 'files' AND ((storage.foldername(name))[1])::uuid = auth.uid());

DROP POLICY IF EXISTS "Users can upload their own files" ON storage.objects;
CREATE POLICY "Users can upload their own files" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'files' AND ((storage.foldername(name))[1])::uuid = auth.uid());

DROP POLICY IF EXISTS "Users can delete their own files" ON storage.objects;
CREATE POLICY "Users can delete their own files" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'files' AND ((storage.foldername(name))[1])::uuid = auth.uid());

-- No UPDATE policy, deliberately: uploads use upsert: false and nothing in the
-- app overwrites an object in place. A rename changes the row in public.files,
-- not the object.
