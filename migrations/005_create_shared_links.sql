-- Migration: create shared_links, the table public share links live in
-- Run this in Supabase SQL Editor.
--
-- This table was created by hand while the sharing feature was being built, and
-- never written down. Every other table in this schema has a migration; this one
-- did not. A fresh Supabase project set up by following the README therefore
-- ended up without it, and POST /api/share answered 500 for a feature the README
-- documents and screenshots. "Migrations are the only source of schema truth"
-- was true of everything except the newest table.
--
-- Why it is numbered after the migration that fixes it. 004 already shipped, and
-- renumbering a file someone may have run is worse than an odd reading order. On
-- a fresh database 004 now finds nothing to fix and does nothing, and this file
-- then creates the table in exactly the shape 004 would have produced. On a
-- database that predates 004, the historical order still holds and this file
-- does nothing. Both files are idempotent, so either order works, twice.
--
-- The shape below was read off the live database rather than reconstructed from
-- 004, because 004 only describes the columns it changed.
--
-- Safe to run twice.

CREATE TABLE IF NOT EXISTS public.shared_links (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    file_id UUID NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
    -- No foreign key to auth.users, matching the live table. Adding one would be
    -- an improvement, but CREATE TABLE IF NOT EXISTS cannot retrofit it onto a
    -- database that already has this table — the two would then differ, which is
    -- the exact class of problem this migration exists to end. If it is wanted,
    -- it needs its own ALTER migration that both paths run.
    created_by UUID NOT NULL,
    -- Never the token itself: only its SHA-256. See 004 for why, and
    -- lib/share.ts for where the hashing happens.
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE,
    revoked_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Lookup by token happens on every visit to /s/:token, and the uniqueness is the
-- guarantee that one token means one file.
CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_links_token_hash
    ON public.shared_links(token_hash);

-- share.service.listLinks() filters by file_id; the file page lists its links.
CREATE INDEX IF NOT EXISTS idx_shared_links_file_id
    ON public.shared_links(file_id);

CREATE INDEX IF NOT EXISTS idx_shared_links_created_by
    ON public.shared_links(created_by);

ALTER TABLE public.shared_links ENABLE ROW LEVEL SECURITY;

-- Owners may list what they have shared and revoke it from the UI. token_hash is
-- useless to them, and the plaintext token is shown once, at creation.
DROP POLICY IF EXISTS "Users can view their own shared links" ON public.shared_links;
CREATE POLICY "Users can view their own shared links" ON public.shared_links
    FOR SELECT USING (created_by = auth.uid());

-- Writes go through /api/share, which verifies ownership of the file before
-- issuing a link, so the client needs no INSERT, UPDATE or DELETE of its own.
-- Lookup by token also happens there, with the service-role key, because the
-- SELECT policy above deliberately does not let a recipient read the row.
REVOKE INSERT, UPDATE, DELETE ON public.shared_links FROM authenticated, anon;
