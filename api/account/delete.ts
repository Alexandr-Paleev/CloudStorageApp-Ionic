import type { VercelRequest, VercelResponse } from '../../libs/server/src/vercel';
import { authenticateUser, AuthError, supabase } from '../../libs/server/src/auth';
import { applyCors } from '../../libs/server/src/cors';
import { RateLimiter, clientIp, tooManyRequests } from '../../libs/server/src/rate-limit';
import { BillingNotClosed, eraseAccount } from '../../libs/server/src/account-erase';
import { configuredProviders } from '../../libs/server/src/erase-providers';
import { report } from '../../libs/server/src/report';

/**
 * DELETE /api/account — erases the caller's account and everything under it.
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

/* Deliberately tighter than the demo limiter. This is destructive and nobody
   has a legitimate reason to call it twice, let alone from a script. */
const limiter = new RateLimiter(5, 60 * 60 * 1000);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;

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
