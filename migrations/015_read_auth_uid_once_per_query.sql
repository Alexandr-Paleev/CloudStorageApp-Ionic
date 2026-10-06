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
-- Written like that, the call is part of the row filter. On a plain index scan
-- over the column it is the index condition, and is made once. On a sequential
-- scan or a bitmap scan it stays a filter, and Postgres makes the call again
-- for every row it reads. And `auth.uid()` is not a stored value: it reads the
-- request's settings and, on the path PostgREST uses today, parses the JWT
-- claims out of one of them as JSON. Its answer cannot change in the middle of
-- a statement, so every call after the first buys nothing.
--
-- `(select auth.uid())` is the same value, computed once. Postgres plans a
-- scalar subquery that does not depend on the row as an InitPlan: it runs
-- before the scan, and each row is compared with its result. Supabase's
-- advisor reports the unwrapped form as `auth_rls_initplan` and recommends
-- this wrapper.
--
-- **Nothing is slow today, and this fixes nothing.** Checked against
-- production, which runs Postgres 17.6, on 2026-10-06: the five tables hold
-- 41, 10, 14, 7 and 0 rows, so whichever way Postgres reads them the call is
-- made a few dozen times at most. What goes away is a cost that arrives with
-- size. Measured on a scratch Postgres 14 carrying these five policies as
-- production has them, over 400 000 files: counting them took 150 ms for an
-- account that owns half of them, which Postgres read with a bitmap scan, and
-- 15 ms after this file. For an account that owns 100 of them, read with an
-- index scan, it took 0.2 ms both times. Production's own planner agrees
-- about the three shapes: asked with EXPLAIN alone, it shows the call as the
-- index condition of an index scan, and as a filter on a bitmap scan and on a
-- sequential one.
--
-- Who may read or write which row does not change. The same checks were run
-- on that scratch database before and after: an account sees its own rows in
-- all five tables and nobody else's, a row made out to someone else is refused
-- on insert and on update, and a caller with no session sees and writes
-- nothing. They passed both times.
--
-- ALTER POLICY rather than DROP and CREATE: the name, the command and the
-- roles of each policy stay as they are because they are not written out
-- again here, and what is not written out again cannot be copied wrongly.
--
-- Applied to production on 2026-10-06, after the pre-flight below showed the
-- five policies with the old spelling and no WITH CHECK. Afterwards it showed
-- the new spelling, and the name, command and roles of every policy as they
-- had been, the three on `storage.objects` included. The plan from the verify
-- step carried an InitPlan and no `current_setting` in its filter. The
-- policies were then probed as a signed-in account, inside transactions that
-- were rolled back. An account saw its own rows in all five tables and no file
-- of anyone else's, and a caller with no session saw nothing. A file and a
-- folder made out to someone else were refused with 42501, and so was handing
-- a folder over to someone else. A row of the account's own went in. No probe
-- row was left behind. The Playwright suite then ran against that database
-- with the policies in place, 43 of 43.
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
-- Pre-flight. It lists every policy in `public`; in production those are the
-- five above. Before the first run each USING reads `auth.uid()`, and after it
-- `( SELECT auth.uid() AS uid)`. The last column is WITH CHECK, which none of
-- the five has. This file rewrites USING alone, so a policy that shows the
-- call in that column needs an ALTER POLICY ... WITH CHECK of its own:
--
--   SELECT c.relname, p.polname,
--          pg_get_expr(p.polqual, p.polrelid) AS using_expr,
--          pg_get_expr(p.polwithcheck, p.polrelid) AS check_expr
--   FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
--   WHERE c.relnamespace = 'public'::regnamespace
--   ORDER BY 1, 2;

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

-- Verify with the pre-flight query: USING now reads
-- `( SELECT auth.uid() AS uid)` in all five. Then ask the planner as a
-- signed-in caller, inside a transaction that is rolled back:
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
