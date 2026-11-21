-- Migration: the pieces of a file's text a question is answered from
-- Run this in Supabase SQL Editor, after 021. Nothing in the app reads or
-- writes this table yet: the step that indexes files into it comes next, so
-- the migration can go before the deploy that uses it.
--
-- 011 keeps one sentence per file, which says what the file is about. A
-- question about what a file says ("until when does my lease run") is answered
-- by a clause, so the text is cut into pieces of at most 400 characters
-- (`libs/core/src/chunks.ts`, measured in evals/ and decided in
-- docs/decisions/0019), and each piece is kept here with its vector. A
-- question is answered from the pieces nearest to it.
--
-- The table follows 011 in everything 011 explains:
--   * `user_id` is the row's own, so the policy stands without a subquery;
--   * the browser may read its own rows and write none; the only writer is
--     the API with the service-role key, and the default grants go (002, 012);
--   * a piece goes with its file, by cascade: an erase, a delete and the demo
--     sweep delete `files` rows and need not know this table exists;
--   * the model that made a vector is written on it, and the search filters
--     by it, so switching models is a re-index and not a silent mixture;
--   * no vector index: an exact scan over one account's pieces is cheap, and
--     an approximate one behind a per-user filter can return too few.
--
-- Nothing here counts against the quota: the bytes were counted when the file
-- was (007, 020), and what lands here is text derived from them.
--
-- Safe to run twice.

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

-- 1. The pieces.
--
-- Keyed by the file and the piece's place in it: re-indexing a file replaces
-- its pieces rather than adding to them. The CHECKs are the limits of
-- `libs/core/src/ai.ts` (CHUNK_SIZE, MAX_PIECES_PER_FILE), held to it by
-- `libs/core/src/file-rules.test.ts`: a model and a parser write what goes
-- in, and a constraint is the one limit no writer can skip (010).
CREATE TABLE IF NOT EXISTS public.file_chunks (
    file_id         UUID NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
    chunk_index     INT  NOT NULL CHECK (chunk_index >= 0 AND chunk_index < 200),
    user_id         UUID NOT NULL,
    -- `char_length` counts code points, as the cut does.
    content         TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 400),
    embedding       vector(1024) NOT NULL,
    embedding_model TEXT NOT NULL,
    indexed_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (file_id, chunk_index)
);

COMMENT ON TABLE public.file_chunks IS
  'The pieces of an indexed file''s text, each with its vector, that a question is answered from (ADR 0019). Written server-side only.';

-- 2. Who may read it, and who may write.
ALTER TABLE public.file_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own file chunks" ON public.file_chunks;
CREATE POLICY "Users can view own file chunks" ON public.file_chunks
    FOR SELECT USING ((SELECT auth.uid()) = user_id);

-- A new table in `public` is given nothing by itself since 2026-10-30 (016),
-- so each role gets what it needs by name: the browser reads, the server
-- writes, `anon` holds nothing (012).
REVOKE ALL ON public.file_chunks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.file_chunks TO authenticated;
GRANT ALL ON public.file_chunks TO service_role;

-- 3. The RLS predicate and the model filter, together.
CREATE INDEX IF NOT EXISTS idx_file_chunks_user_model
    ON public.file_chunks(user_id, embedding_model);

-- 4. The search.
--
-- As `match_files`, and for its reasons: run by the caller, under both
-- tables' policies; joined to `files`, so a piece whose file is gone cannot
-- come back; the caller asks for a count and the function caps it. Twenty,
-- because a model reads every piece returned, and eight of 400 characters are
-- already more than the eval needed to find every answer.
CREATE OR REPLACE FUNCTION public.match_chunks(
    query_embedding vector(1024),
    model_name      TEXT,
    match_count     INT  DEFAULT 8,
    min_similarity  REAL DEFAULT 0
)
RETURNS TABLE (
    file_id     UUID,
    file_name   TEXT,
    chunk_index INT,
    content     TEXT,
    similarity  REAL
)
LANGUAGE sql
STABLE
SET search_path = public, extensions, pg_temp
AS $$
    SELECT c.file_id, f.name, c.chunk_index, c.content,
           (1 - (c.embedding <=> query_embedding))::REAL AS similarity
    FROM public.file_chunks c
    JOIN public.files f ON f.id = c.file_id
    WHERE c.embedding_model = model_name
      AND (c.embedding <=> query_embedding) <= (1 - min_similarity)
    -- The file and the place in it break a tie, so the same question reads
    -- the same pieces in the same order every time.
    ORDER BY (c.embedding <=> query_embedding), c.file_id, c.chunk_index
    LIMIT LEAST(GREATEST(match_count, 1), 20)
$$;

COMMENT ON FUNCTION public.match_chunks(vector, TEXT, INT, REAL) IS
  'The pieces of the calling user''s own files nearest to a question. Not granted to service_role on purpose: a bypassrls caller would rank every account''s pieces together.';

REVOKE ALL ON FUNCTION public.match_chunks(vector, TEXT, INT, REAL)
    FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.match_chunks(vector, TEXT, INT, REAL) TO authenticated;

COMMIT;

-- Verify — one policy, SELECT alone for `authenticated`, nothing for `anon`,
-- and the function executable by `authenticated` alone:
--
--   SELECT policyname, cmd, roles FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'file_chunks';
--
--   SELECT grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type)
--   FROM information_schema.role_table_grants
--   WHERE table_schema = 'public' AND table_name = 'file_chunks' GROUP BY grantee;
--
--   SELECT proname, proconfig, prosecdef, proacl FROM pg_proc
--   WHERE pronamespace = 'public'::regnamespace AND proname = 'match_chunks';
--
-- And the check that matters, in a transaction that rolls back: a piece of one
-- account's file is found by that account's search and by no other's.
