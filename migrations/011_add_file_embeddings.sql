-- Migration: semantic search over a user's own files
-- Run this in Supabase SQL Editor, after 010.
--
-- The dashboard searches with `ilike '%term%'` against `files.name`
-- (src/utils/file-query.ts). Two thirds of the rows in production are photos
-- carrying the name the camera gave them, so for those the search answers one
-- question — "do you remember the filename" — and the answer is no.
--
-- This is the other kind of search. At upload time a sentence describing the
-- file is written, turned into a vector, and stored beside the row; a query is
-- turned into a vector the same way, and Postgres orders by the distance
-- between the two. The sentence is kept as well as the vector: a result that
-- cannot say why it matched is indistinguishable from a wrong one.
--
-- Nothing in the browser writes here. The only writer is
-- `api/ai/[action].ts` with the service-role key, which is why this table has
-- a SELECT policy and no other, and why the table-level grants are revoked
-- below — the lesson of 002, one table further on.
--
-- It costs nothing against the storage quota: the trigger in 007 counts
-- `files.size` for the three hosted providers, and what lands here is text and
-- a vector belonging to a row that has already been counted.
--
-- Safe to run twice.
--
-- Applied to production on 2026-09-27, and run twice: the second pass tightened
-- the grants after the first one showed what the defaults had handed out.
--
-- Verified against the live database rather than assumed, with a probe row on
-- a real file inside a transaction that cleaned up after itself:
--
--   * the owner's search returns it, and so does a direct SELECT;
--   * another account's search returns nothing, and so does its SELECT — 0
--     rows, not a lower rank;
--   * the same vector under another model's name returns nothing, which is
--     the filter below doing its job;
--   * an INSERT as `authenticated` is refused with 42501;
--   * `authenticated` is left holding SELECT and nothing else, `anon` nothing
--     at all, and `match_files` is executable by `authenticated` alone.

BEGIN;

-- 1. pgvector.
--
-- `WITH SCHEMA extensions` is the Supabase convention. A project that
-- installed the extension earlier may have it in `public`, and CREATE
-- EXTENSION IF NOT EXISTS neither moves it nor complains. Rather than guess
-- which of the two this project has, everything below refers to the type
-- unqualified and runs with both schemas on the path, so it resolves wherever
-- the extension actually lives. `SET LOCAL` reverts at COMMIT.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

-- 2. The index rows.
--
-- One row per file, keyed by the file: a file has exactly one description, and
-- re-indexing overwrites rather than accumulates. ON DELETE CASCADE is what
-- keeps this table honest — `libs/server/src/account-erase.ts` and the demo sweep in
-- `api/demo/session.ts` both delete `files` rows and rely on the cascades for
-- everything hanging off them, as `shared_links` already does.
--
-- `user_id` is duplicated from `files` on purpose. The policy below could have
-- read `EXISTS (SELECT 1 FROM files WHERE ...)` instead, and 006 is the file
-- that explains why it does not: a subquery inside a policy is itself subject
-- to RLS on the table it reads, so the privacy of one table silently comes to
-- depend on the policies of another. A predicate that stands on its own cannot
-- be undone by an edit somewhere else.
--
-- Both CHECKs exist because a model writes into these columns. Neither is a
-- likely failure; both are cheap, and a constraint is the only writer-agnostic
-- place to put a limit (010).
CREATE TABLE IF NOT EXISTS public.file_embeddings (
    file_id         UUID PRIMARY KEY REFERENCES public.files(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL,
    -- Shown under the result. One sentence, not a paragraph.
    summary         TEXT NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 500),
    tags            TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 12),
    -- voyage-4 at its default dimension. Changing the model means changing
    -- this number, which means a new column and a backfill, not an ALTER:
    -- vectors of different models are not comparable.
    embedding       vector(1024) NOT NULL,
    -- Which model said what, so a row can be re-made rather than guessed at
    -- when either one changes. The eval needs to know this to explain a drop.
    summary_model   TEXT NOT NULL,
    embedding_model TEXT NOT NULL,
    indexed_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE public.file_embeddings IS
  'One row per indexed file: the sentence a model wrote about it, and that sentence as a vector. Written server-side only.';

-- 3. Who may read it.
ALTER TABLE public.file_embeddings ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY has no IF NOT EXISTS; without the drop a second run fails.
DROP POLICY IF EXISTS "Users can view own file embeddings" ON public.file_embeddings;
CREATE POLICY "Users can view own file embeddings" ON public.file_embeddings
    FOR SELECT USING (auth.uid() = user_id);

-- No INSERT, UPDATE or DELETE policy, and the grants go too. Supabase hands
-- the API roles full DML on a new table in `public`, so without this line RLS
-- would be the only thing in the way, and re-adding a policy later would be
-- enough to reopen the door (002).
--
-- ALL, then SELECT back, rather than naming the three write verbs. Checked on
-- the live database after the first pass of this migration: the default grant
-- also carries TRUNCATE, REFERENCES and TRIGGER, and the first of those is not
-- constrained by RLS at all — a policy decides which rows a statement sees,
-- and TRUNCATE does not look at rows. PostgREST exposes no way to issue one
-- today, so this is a latent privilege rather than a hole, which is exactly
-- the kind that outlives the reason it was safe. `service_role` keeps its own
-- grants: it is what writes here.
REVOKE ALL ON public.file_embeddings FROM authenticated, anon;
GRANT SELECT ON public.file_embeddings TO authenticated;

-- 4. Indexes.
--
-- The btree carries the RLS predicate. There is deliberately no vector index:
-- an HNSW index makes the search approximate, and with a per-user filter in
-- front of it an approximate scan can return fewer rows than asked for — the
-- wrong trade when an account holds tens of files and an exact scan costs
-- microseconds. The statement to add one, and when, is at the bottom.
CREATE INDEX IF NOT EXISTS idx_file_embeddings_user_id
    ON public.file_embeddings(user_id, embedding_model);

-- 5. The search.
--
-- Deliberately not SECURITY DEFINER: run by the caller, it sees exactly the
-- rows both policies allow — this table's, and `files`' own. The join is not a
-- second filter for show; it is what makes a row that lost its file
-- unreachable even if a cascade ever failed to fire.
--
-- `search_path` is pinned for the reason 009 pins the others: unqualified
-- names inside a function must not resolve through whatever path the caller
-- happened to have, and here the `<=>` operator is one of those names.
CREATE OR REPLACE FUNCTION public.match_files(
    query_embedding vector(1024),
    model_name      TEXT,
    match_count     INT  DEFAULT 10,
    min_similarity  REAL DEFAULT 0
)
RETURNS TABLE (
    id           UUID,
    name         TEXT,
    size         BIGINT,
    type         TEXT,
    download_url TEXT,
    storage_path TEXT,
    storage_type TEXT,
    folder_id    UUID,
    user_id      UUID,
    created_at   TIMESTAMPTZ,
    summary      TEXT,
    tags         TEXT[],
    similarity   REAL
)
LANGUAGE sql
STABLE
SET search_path = public, extensions, pg_temp
AS $$
    SELECT f.id, f.name, f.size, f.type, f.download_url, f.storage_path,
           f.storage_type, f.folder_id, f.user_id, f.created_at,
           e.summary, e.tags,
           (1 - (e.embedding <=> query_embedding))::REAL AS similarity
    FROM public.file_embeddings e
    JOIN public.files f ON f.id = e.file_id
    -- Only rows made by the same embedding model. Two models place the same
    -- sentence in different spaces, so a distance measured across them is not
    -- a smaller number — it is a meaningless one, and the row it promotes
    -- looks exactly like a good answer. This is what makes switching provider
    -- a re-index rather than a silent degradation.
    WHERE e.embedding_model = model_name
    -- Written as a distance rather than a similarity so the comparison stays
    -- on the operator's own terms, and parenthesised rather than trusting the
    -- precedence of a user-defined operator.
      AND (e.embedding <=> query_embedding) <= (1 - min_similarity)
    ORDER BY (e.embedding <=> query_embedding)
    -- The caller asks; the function decides. A page is 15 rows in the
    -- dashboard, and nothing should be able to ask for the whole table.
    LIMIT LEAST(GREATEST(match_count, 1), 50)
$$;

COMMENT ON FUNCTION public.match_files(vector, TEXT, INT, REAL) IS
  'Nearest neighbours among the calling user''s own files. Not granted to service_role on purpose: a bypassrls caller would rank every account''s files together.';

-- Functions are executable by PUBLIC unless told otherwise, which is how the
-- four in 009 ended up carrying `anon=X`. This one is for signed-in callers
-- and no one else — including `service_role`, which bypasses RLS and would
-- therefore rank every account's files together. Supabase grants that role
-- EXECUTE by default, so naming it here is the only way it goes: the first
-- pass of this migration revoked PUBLIC and anon, and `proacl` still read
-- `service_role=X`.
REVOKE ALL ON FUNCTION public.match_files(vector, TEXT, INT, REAL)
    FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.match_files(vector, TEXT, INT, REAL) TO authenticated;

COMMIT;

-- Verify — expects `vector` present, one policy, and no write grants:
--
--   SELECT extname, extnamespace::regnamespace FROM pg_extension WHERE extname = 'vector';
--
--   SELECT policyname, cmd, roles FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'file_embeddings';
--
--   SELECT privilege_type, grantee FROM information_schema.role_table_grants
--   WHERE table_schema = 'public' AND table_name = 'file_embeddings'
--     AND grantee IN ('anon', 'authenticated');
--
-- And that the function is pinned and not callable by anon or service_role:
--
--   SELECT proname, proconfig, prosecdef, proacl FROM pg_proc
--   WHERE pronamespace = 'public'::regnamespace AND proname = 'match_files';
--
-- Then the check that matters, which is not a catalogue query. With two
-- accounts and a row indexed for the first, a search run as the second must
-- come back empty rather than ranked lower — run it inside a transaction that
-- rolls back:
--
--   BEGIN;
--   SET LOCAL role authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<second user id>","role":"authenticated"}';
--   SELECT id, similarity FROM public.match_files(
--     (SELECT embedding FROM public.file_embeddings LIMIT 1),
--     (SELECT embedding_model FROM public.file_embeddings LIMIT 1), 10, 0);
--   ROLLBACK;
--
-- When this table grows past a few thousand rows per account, the exact scan
-- stops being free and the index below becomes worth its approximation. Adding
-- it is a migration of its own, together with a re-run of the eval: it changes
-- which rows come back, not only how fast.
--
--   CREATE INDEX idx_file_embeddings_hnsw ON public.file_embeddings
--     USING hnsw (embedding vector_cosine_ops);
