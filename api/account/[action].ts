import { timingSafeEqual } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../../libs/server/src/vercel';
import { authenticateUser, AuthError, supabase } from '../../libs/server/src/auth';
import { applyCors } from '../../libs/server/src/cors';
import { RateLimiter, clientIp, tooManyRequests } from '../../libs/server/src/rate-limit';
import { BillingNotClosed, eraseAccount } from '../../libs/server/src/account-erase';
import { configuredProviders } from '../../libs/server/src/erase-providers';
import { reconcile, summarize, failed } from '../../libs/server/src/reconcile';
import { reconcileDeps } from '../../libs/server/src/reconcile-providers';
import { report } from '../../libs/server/src/report';

/**
 * Two actions, one serverless function:
 *
 *   DELETE /api/account/delete      erases the caller's account and everything under it
 *   GET    /api/account/reconcile   the nightly reconciliation, called by Vercel Cron
 *
 * This was delete.ts until the reconciliation needed a route and the Hobby
 * plan's twelve functions were all used (docs/decisions/0008). The path of the
 * first is unchanged: /api/account/delete resolves to this file through the
 * dynamic segment, as /api/r2/delete does.
 */

/* Deliberately tighter than the demo limiter. This is destructive and nobody
   has a legitimate reason to call it twice, let alone from a script. */
const limiter = new RateLimiter(5, 60 * 60 * 1000);

/**
 * Erases the caller's account.
 *
 * Both stores require this of any app that lets a person sign up: Apple in
 * guideline 5.1.1(v), Google in its account-deletion policy. Neither accepts a
 * support address, and neither accepts deactivation.
 *
 * It runs server-side because most of the work is beyond what the browser is
 * allowed to do: `auth.admin.deleteUser` needs the service-role key, and the
 * R2 and Cloudinary credentials never leave a function. The client holds a
 * session, not authority.
 *
 * There is no undo, which is the point.
 */
async function deleteAccount(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'DELETE' && req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const ip = clientIp(req.headers, req.socket?.remoteAddress);
  if (!limiter.allow(ip)) {
    return tooManyRequests(
      res,
      limiter.retryAfterSeconds(ip),
      'Too many deletion attempts. Try again later.'
    );
  }

  /* Outside the try, so that a failure once the caller is known is reported
     with the account it was for: a deletion that did not happen is finished
     by hand, and only the id says whose it was. */
  let userId: string | undefined;

  try {
    userId = await authenticateUser(req);

    /* The erase ends what the account pays for before it erases anything, and
       stops if it cannot: libs/server/src/account-erase.ts. */
    const { failures } = await eraseAccount(userId, {
      supabase,
      ...configuredProviders(),
    });

    /* 200 with the list rather than a 500: the account is gone either way, and
       telling the caller their login still works would be a lie. */
    return res.status(200).json({ deleted: true, failures });
  } catch (error) {
    /* Nothing was erased, and the caller is told why with the status the
       erase chose: 503 for a deployment that cannot reach Stripe, 502 for
       Stripe not doing it. */
    if (error instanceof BillingNotClosed) {
      await report(error, { route: 'account/delete', userId, level: 'warning' });
      return res.status(error.status).json({ message: error.message });
    }

    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('Account deletion error:', error);
    if (!(error instanceof AuthError)) await report(error, { route: 'account/delete', userId });
    return res.status(error instanceof AuthError ? 401 : 500).json({ message });
  }
}

/** Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when the project
 *  has that variable. Compared in constant time. */
function isCron(header: string | string[] | undefined, secret: string): boolean {
  const given = Buffer.from(typeof header === 'string' ? header : '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * The nightly reconciliation of hosted storage (libs/server/src/reconcile.ts,
 * docs/decisions/0018). Scheduled in vercel.json.
 *
 * Without CRON_SECRET nothing can call it, and it says so rather than run
 * open. Without RECONCILE_APPLY=true it removes and changes nothing: the
 * answer and the report say what it would have done.
 */
async function reconcileStorage(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return res.status(503).json({ message: 'Reconciliation is not configured' });
  }
  if (!isCron(req.headers.authorization, secret)) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const outcome = await reconcile(reconcileDeps(supabase), {
      now: new Date(),
      apply: process.env.RECONCILE_APPLY === 'true',
    });

    /* Counts only: a path holds an owner's id and a file's name. */
    const summary = summarize(outcome);
    if (summary) {
      await report(new Error(summary), {
        route: 'account/reconcile',
        level: failed(outcome) ? 'error' : 'warning',
      });
    }
    return res.status(200).json(outcome);
  } catch (error) {
    console.error('Reconciliation error:', error);
    await report(error, { route: 'account/reconcile' });
    return res.status(500).json({ message: 'Reconciliation failed' });
  }
}

const ACTIONS: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<unknown>> = {
  delete: deleteAccount,
  reconcile: reconcileStorage,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;

  const name = Array.isArray(req.query.action) ? req.query.action[0] : req.query.action;
  /* Own keys only: `toString` is on every object, and is not an action.
     Not Object.hasOwn, which the library Vercel builds against does not have. */
  const action =
    name && Object.prototype.hasOwnProperty.call(ACTIONS, name) ? ACTIONS[name] : undefined;
  if (!action) {
    return res.status(404).json({ message: `Unknown action "${name ?? ''}"` });
  }
  return action(req, res);
}
