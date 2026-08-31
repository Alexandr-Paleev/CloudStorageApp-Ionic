-- Migration: close public read access to shared_links, and store token hashes
-- Run this in Supabase SQL Editor.
--
-- The table shipped with a policy named "Anyone can read shared links by token"
-- defined as USING (true) for role public. That is not "read by token" — it is
-- read everything. The anon key is published in the client bundle, so anyone
-- could do
--
--   GET /rest/v1/shared_links?select=token,file_id
--
-- and collect every share token in one request, then open every shared file.
-- Verified against the live database before writing this.
--
-- Two changes:
--
-- 1. No client-side access at all. Lookup by token happens in /api/share, which
--    uses SUPABASE_SERVICE_ROLE_KEY and bypasses RLS — the same shape as
--    dropbox_connections. Owners still list their own links, without the secret.
--
-- 2. The token is stored as a SHA-256 hash. A leak of this table then reveals
--    nothing usable, and the plaintext exists only in the URL the owner copies.
--
-- The single pre-existing row is dropped: its token was readable by the whole
-- internet, and no code ever served it.
--
-- On a database where the table does not exist yet, this file does nothing and
-- 005 creates the table already in the shape produced here.
--
-- The guard used to cover only part of the file. RETURN inside DO exits the
-- block, not the script, so the seven statements that once sat below it ran
-- unguarded and the whole migration failed with "relation shared_links does not
-- exist" on any fresh database — the opposite of the "safe to run" the header
-- claimed. Everything now lives inside the one guarded block.
--
-- Safe to run twice, and safe to run before 001 or before the table exists.

DO $$
BEGIN
    IF to_regclass('public.shared_links') IS NULL THEN
        RAISE NOTICE 'public.shared_links does not exist — 005 creates it; nothing to fix here.';
        RETURN;
    END IF;

    -- The hole itself.
    DROP POLICY IF EXISTS "Anyone can read shared links by token" ON public.shared_links;

    -- Writes go through /api/share, which verifies ownership of the file before
    -- issuing a link, so the client needs no INSERT or DELETE of its own.
    DROP POLICY IF EXISTS "Users can create shared links for their files" ON public.shared_links;
    DROP POLICY IF EXISTS "Users can delete their own shared links" ON public.shared_links;
    REVOKE INSERT, UPDATE, DELETE ON public.shared_links FROM authenticated, anon;

    -- Compromised by the policy above, and unreachable anyway. Guarded by the
    -- presence of the plaintext column, so this only ever fires on a table that
    -- has not been through this migration yet. It used to run unconditionally,
    -- which made every later re-run delete the live share links — the opposite
    -- of the "safe to run twice" promised above, and of what the README tells
    -- the reader to do with the migrations directory.
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'shared_links'
          AND column_name = 'token'
    ) THEN
        DELETE FROM public.shared_links;
    END IF;

    ALTER TABLE public.shared_links
        ADD COLUMN IF NOT EXISTS token_hash TEXT,
        ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP WITH TIME ZONE;

    -- The plaintext column has no reason to exist: what is stored is the hash.
    ALTER TABLE public.shared_links DROP COLUMN IF EXISTS token;

    -- A row without a hash cannot be looked up by any token and is therefore
    -- unreachable by construction — /api/share finds a link by hashing what the
    -- visitor presents. Removing them is what makes the NOT NULL below safe on a
    -- table someone half-migrated by hand; on a healthy one it matches nothing.
    DELETE FROM public.shared_links WHERE token_hash IS NULL;

    ALTER TABLE public.shared_links ALTER COLUMN token_hash SET NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_links_token_hash
        ON public.shared_links(token_hash);
    CREATE INDEX IF NOT EXISTS idx_shared_links_created_by
        ON public.shared_links(created_by);

    ALTER TABLE public.shared_links ENABLE ROW LEVEL SECURITY;

    -- Owners may list what they have shared and revoke it from the UI. token_hash
    -- is useless to them, and the plaintext token is shown once, at creation.
    DROP POLICY IF EXISTS "Users can view their own shared links" ON public.shared_links;
    CREATE POLICY "Users can view their own shared links" ON public.shared_links
        FOR SELECT USING (created_by = auth.uid());
END $$;
