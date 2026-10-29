import type { VercelRequest, VercelResponse } from '../../libs/server/src/vercel';
import Stripe from 'stripe';
import { authenticateUser, AuthError, supabase } from '../../libs/server/src/auth';
import { applyCors } from '../../libs/server/src/cors';
import { RateLimiter, clientIp, tooManyRequests } from '../../libs/server/src/rate-limit';
import { eraseAccount } from '../../libs/server/src/account-erase';
import { configuredProviders } from '../../libs/server/src/erase-providers';
import { isMissingInStripe } from '../../libs/server/src/stripe';

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

/** The account's Stripe customer, if it ever opened a checkout. */
async function stripeCustomerOf(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', userId)
    .limit(1);

  if (error) throw new Error(`Failed to read the profile: ${error.message}`);

  const rows = (data || []) as { stripe_customer_id: string | null }[];
  return rows[0]?.stripe_customer_id ?? null;
}

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

  try {
    const userId = await authenticateUser(req);

    /* What the account pays for ends before anything of it is erased. The
       profile is the only link between an account and its Stripe customer,
       and the erase deletes it: a subscription left behind went on renewing
       every month, with nothing in the app left to cancel it from — the
       billing portal is opened from the profile — and every renewal reached
       the webhook for an account that was not there.

       Deleting the customer cancels its subscriptions at once, refunds
       nothing, and removes the card details Stripe held for it; its history,
       invoices included, stays in Stripe. Already deleted counts as done, so
       a second attempt after an erase that failed halfway gets through.
       Anything else stops here, with nothing erased: an account that is gone
       and still paying is worse than a deletion that has to be asked for
       again. */
    const customerId = await stripeCustomerOf(userId);
    if (customerId) {
      const key = process.env.STRIPE_SECRET_KEY;
      if (!key) {
        return res.status(503).json({
          message: 'Billing is not configured here, so it cannot be closed. Nothing was deleted.',
        });
      }

      try {
        await new Stripe(key).customers.del(customerId);
      } catch (error) {
        if (!isMissingInStripe(error)) {
          console.error('Account deletion: Stripe did not delete the customer:', error);
          return res.status(502).json({
            message:
              'Your billing could not be closed with Stripe, so nothing was deleted. Try again in a moment.',
          });
        }
      }
    }

    const { failures } = await eraseAccount(userId, {
      supabase,
      ...configuredProviders(),
    });

    /* 200 with the list rather than a 500: the account is gone either way, and
       telling the caller their login still works would be a lie. */
    return res.status(200).json({ deleted: true, failures });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('Account deletion error:', error);
    return res.status(error instanceof AuthError ? 401 : 500).json({ message });
  }
}
