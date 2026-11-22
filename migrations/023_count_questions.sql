-- Migration: a question asked of one's files is counted against the day
-- Run this in Supabase SQL Editor, after 022, and before the deployment that
-- adds /api/ai/ask: that route claims every question with the action 'ask',
-- and the CHECK from 017 refuses any action but 'index' and 'embed'.
--
-- A question is answered by a model reading the pieces nearest to it
-- (docs/decisions/0019). Production answers on Workers AI, inside Cloudflare's
-- free daily allocation, and every account may ask: what keeps the allocation
-- from being spent by one visitor is the budget of 017, per account and for
-- the deployment, which this extends to a third action. The limits themselves
-- are in `libs/server/src/ai-budget.ts`; `claim_ai_call` takes the action as
-- a parameter and needs no change.
--
-- Safe to run twice.

BEGIN;

ALTER TABLE public.ai_usage DROP CONSTRAINT IF EXISTS ai_usage_action_check;
ALTER TABLE public.ai_usage
    ADD CONSTRAINT ai_usage_action_check CHECK (action IN ('index', 'embed', 'ask'));

COMMIT;

-- Verify:
--
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'public.ai_usage'::regclass AND conname = 'ai_usage_action_check';
--   → CHECK ((action = ANY (ARRAY['index'::text, 'embed'::text, 'ask'::text])))
--
-- And, in a transaction that rolls back, that a question is claimed and an
-- unknown action is not:
--
--   BEGIN;
--   SELECT public.claim_ai_call('<an account id>', 'ask', 20, 100);   -- 'ok'
--   SELECT public.claim_ai_call('<an account id>', 'nope', 20, 100);  -- 23514
--   ROLLBACK;
