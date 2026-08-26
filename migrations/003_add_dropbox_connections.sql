-- Migration: move Dropbox refresh tokens out of the browser
-- Run this in Supabase SQL Editor.
--
-- dropbox-auth.service.ts kept the refresh token in localStorage. That token is
-- long-lived and, unlike the access token, does not expire on its own: any XSS
-- on the page could read it and keep reaching the user's Dropbox indefinitely,
-- with no way for us to notice or revoke it. The access token stays in the
-- browser (uploads go straight to Dropbox — proxying them through a serverless
-- function would cap files at the 4.5 MB request body limit), but it now lives
-- in memory only and expires in hours.
--
-- Safe to run twice.

CREATE TABLE IF NOT EXISTS public.dropbox_connections (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    refresh_token TEXT NOT NULL,
    account_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.dropbox_connections ENABLE ROW LEVEL SECURITY;

-- No policies at all, on purpose. The whole point of this table is that the
-- browser never sees refresh_token, so there is no SELECT policy either — even
-- for the owning user. Everything here is read and written server-side with
-- SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS. "Is Dropbox connected?" is
-- answered by GET /api/dropbox/token, not by querying this table from the app.
REVOKE ALL ON public.dropbox_connections FROM authenticated, anon;
