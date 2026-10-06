-- Migration: read the caller's id once per query, not once per row
-- Run this in Supabase SQL Editor.
--
-- Five policies decide whose rows a signed-in caller may touch by comparing a
-- column with `auth.uid()`:
--
--   files            Users can manage their own files        auth.uid() = user_id
--   folders          Users can manage their own folders      auth.uid() = user_id
--   profiles         Users can view own profile              auth.uid() = id
--   shared_links     Users can view their own shared links   created_by = auth.uid()
--   file_embeddings  Users can view own file embeddings      auth.uid() = user_id
--
-- Written like that, the call is part of the row filter. Where Postgres can
-- reach the rows through an index on the column, the call is the index
-- condition and is made once. Where it reads the table itself, it makes the
-- call again for every row it reads. And `auth.uid()` is not a stored value:
-- it reads the request's settings and, on the path PostgREST uses today,
-- parses the JWT claims out of one of them as JSON. Its answer cannot change
-- in the middle of a statement, so every call after the first buys nothing.
--
-- `(select auth.uid())` is the same value, computed once. Postgres plans a
-- scalar subquery that does not depend on the row as an InitPlan: it runs
-- before the scan, and each row is compared with its result. Supabase's
-- advisor reports the unwrapped form as `auth_rls_initplan` and recommends
-- this wrapper.
--
-- **Nothing is slow today, and this fixes nothing.** Checked against
-- production on 2026-10-06: the five tables hold 41, 10, 14, 7 and 0 rows, and
-- the plan for a read of `files` is an index scan on `idx_files_user_id`,
-- which already makes the call once. What goes away is a cost that arrives
-- with size. Measured on a scratch Postgres 14 carrying these five policies
-- as production has them, over 400 000 files: counting them took 150 ms for
-- an account that owns half of them, and 15 ms after this file. For an account
-- that owns 100 of them it took 0.2 ms both times.
--
-- Who may read or write which row does not change. The same checks were run
-- on that database before and after: an account sees its own rows in all five
-- tables and nobody else's, a row made out to someone else is refused on
-- insert and on update, and a caller with no session sees and writes nothing.
-- They passed both times.
--
-- ALTER POLICY rather than DROP and CREATE. The policy keeps its name, its
-- command and its roles, and there is no moment at which the table has row
-- level security on and no policy, which would refuse everyone.
--
-- Safe to run twice: ALTER POLICY sets the expression, and setting it to what
-- it already is changes nothing. On a database that lacks one of the five, the
-- statement naming it fails and the transaction takes the others back with it.
--
-- 000, 001, 004, 005 and 011 create these policies and still spell the call
-- the old way, so running one of them again puts the old spelling back. Run
-- this file after them.
--
-- The three policies on `storage.objects` (006) make the same call and are
-- left as they are; the advisor's lint does not cover that schema. The browser
-- asks Storage for one object at a time: an upload, a signed URL, a removal by
-- path. Each of those policies is therefore asked about one object per
-- request. The only listing, in account erasure, runs with the service-role
-- key, which bypasses them.
--
-- Pre-flight — expects the five rows above, none of them containing `SELECT`:
--
--   SELECT c.relname, p.polname, pg_get_expr(p.polqual, p.polrelid)
--   FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
--   WHERE c.relnamespace = 'public'::regnamespace
--   ORDER BY 1;

BEGIN;

ALTER POLICY "Users can manage their own files" ON public.files
  USING ((SELECT auth.uid()) = user_id);

ALTER POLICY "Users can manage their own folders" ON public.folders
  USING ((SELECT auth.uid()) = user_id);

ALTER POLICY "Users can view own profile" ON public.profiles
  USING ((SELECT auth.uid()) = id);

ALTER POLICY "Users can view their own shared links" ON public.shared_links
  USING (created_by = (SELECT auth.uid()));

ALTER POLICY "Users can view own file embeddings" ON public.file_embeddings
  USING ((SELECT auth.uid()) = user_id);

COMMIT;

-- Verify with the pre-flight query: each expression now reads
-- `( SELECT auth.uid() AS uid)` where it read `auth.uid()`. Then ask the
-- planner as a signed-in caller, inside a transaction that is rolled back:
--
--   BEGIN;
--   SELECT set_config('request.jwt.claims',
--     json_build_object('sub', (SELECT id FROM auth.users LIMIT 1))::text, true);
--   SET LOCAL ROLE authenticated;
--   EXPLAIN SELECT * FROM public.files;
--   ROLLBACK;
--
-- The plan must carry an InitPlan. `current_setting` must appear in no Filter
-- and no Index Cond: that is the body of `auth.uid()`, which Postgres inlines,
-- and it is how the old spelling shows up in a plan.
