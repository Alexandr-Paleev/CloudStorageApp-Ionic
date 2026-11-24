import { supabase } from './auth';

/**
 * How many paid AI calls this deployment makes in a day, and the claim each
 * call makes against that before it is made.
 *
 * The limits in rate-limit.ts are per minute and per instance: they stop a
 * loop, and a loop spread over a day, or over the instances Vercel starts,
 * walks past them. What bounds a bill has to be counted where every instance
 * sees the same number, so this is counted in the database, by
 * `claim_ai_call` from migrations/017.
 *
 * Two counters for each call, both for the day (UTC). The account's keeps one
 * person from spending everyone's share. The deployment's is the one that
 * bounds the bill, because accounts cost nothing to make: the demo hands one
 * to anyone who opens the site.
 */

export type AiAction = 'index' | 'embed' | 'ask';

export interface DailyLimit {
  perAccount: number;
  total: number;
}

export const AI_DAILY_LIMITS: Record<AiAction, DailyLimit> = {
  /* Describing a file is the call that costs: a picture or a document read by
     a model. A hundred a day lets one person index a folder of photographs;
     three hundred is the most the deployment pays for in a day, whoever asks. */
  index: { perAccount: 100, total: 300 },
  /* A search is one line of text embedded, a fraction of a description. The
     searchbar debounces at 300ms, so a sentence typed slowly is several. */
  embed: { perAccount: 300, total: 5000 },
  /* A question is a model reading the pieces nearest to it and writing an
     answer (ADR 0019): on the free path some 65 of Cloudflare's 10,000 free
     neurons a day, against the 32 and 50 per thousand tokens it lists for
     mistral-small. A hundred leaves room for indexing and searching inside
     the free allocation, and twenty an account lets anyone try it, a demo
     included, without one visitor taking the day. */
  ask: { perAccount: 20, total: 100 },
};

/**
 * The deployment's limit can be changed without a release. Only that one: it
 * is the number that decides the bill, and 0 stops the spending at once
 * without taking the keys away.
 */
const TOTAL_VARIABLE: Record<AiAction, string> = {
  index: 'AI_INDEX_DAILY_LIMIT',
  embed: 'AI_EMBED_DAILY_LIMIT',
  ask: 'AI_ASK_DAILY_LIMIT',
};

export function dailyLimit(action: AiAction): DailyLimit {
  const { perAccount, total } = AI_DAILY_LIMITS[action];
  const name = TOTAL_VARIABLE[action];
  const raw = process.env[name]?.trim();
  if (!raw) return { perAccount, total };

  const configured = Number(raw);
  if (Number.isInteger(configured) && configured >= 0) {
    return { perAccount, total: configured };
  }

  /* The default rather than a refusal: a typo in a dashboard should not take
     the feature down, and the default is a bound too. */
  console.warn(`${name}=${JSON.stringify(raw)} is not a whole number; using ${total}`);
  return { perAccount, total };
}

/** Today's limit is spent, for this account or for the whole deployment. */
export class BudgetSpent extends Error {
  constructor(
    readonly scope: 'account' | 'deployment',
    message: string
  ) {
    super(message);
  }
}

/* What happened, and what still works, but not when to come back: the day
   turns over at midnight UTC, which is "tomorrow" in one place and "at one in
   the morning" in another. The 429 carries the moment (`retryAt`), and the
   app says it in the reader's own time. */
const SPENT: Record<AiAction, Record<BudgetSpent['scope'], string>> = {
  index: {
    account: 'You have indexed as many files today as a day allows.',
    deployment: 'This site has indexed as many files today as it allows in a day.',
  },
  embed: {
    account:
      'You have searched by meaning as many times today as a day allows. Searching by name still works.',
    deployment:
      'Search by meaning has reached this site’s limit for today. Searching by name still works.',
  },
  ask: {
    account: 'You have asked as many questions today as a day allows. Searching still works.',
    deployment: 'Questions have reached this site’s free limit for today. Searching still works.',
  },
};

/**
 * Claims one call from today's budget, or throws BudgetSpent.
 *
 * Asked immediately before the call that costs, and after every check that
 * can refuse for free, so a refusal of another kind spends nothing. A call
 * that then fails at the provider stays counted: it reached the provider.
 */
export async function claimAiCall(userId: string, action: AiAction): Promise<void> {
  const { perAccount, total } = dailyLimit(action);

  const { data, error } = await supabase.rpc('claim_ai_call', {
    p_user: userId,
    p_action: action,
    p_user_limit: perAccount,
    p_total_limit: total,
  });

  if (error) {
    /* Deploy order, as in quota.ts: the function arrives with migrations/017,
       and PostgREST's words for its absence name neither. */
    if (error.code === 'PGRST202' || /claim_ai_call/.test(error.message)) {
      throw new Error(
        'The daily budget for AI calls is not set up — apply migrations/017_bound_ai_spend.sql'
      );
    }
    /* Refused, not waved through. This exists to bound a bill, and a check
       that lets every call past whenever it cannot read its counter bounds
       nothing. */
    throw new Error(`Could not check the daily budget for AI calls: ${error.message}`);
  }

  const answer: unknown = data;
  if (answer === 'ok') return;
  if (answer === 'account' || answer === 'deployment') {
    throw new BudgetSpent(answer, SPENT[action][answer]);
  }
  throw new Error(`claim_ai_call answered ${JSON.stringify(answer)}`);
}

/** Seconds until the counters start again at midnight UTC: the Retry-After
 *  of a refusal. Never zero, for the reason retryAfterSeconds gives. */
export function secondsUntilTomorrow(now: Date = new Date()): number {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((midnight - now.getTime()) / 1000));
}
