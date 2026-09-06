import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { authenticateUser, AuthError, supabase } from '../../lib/auth';
import { getAppUrl } from '../../lib/app-url';
import { applyCors } from '../../lib/cors';
import { BILLING_LIMIT, RateLimiter, tooManyRequests } from '../../lib/rate-limit';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

/* Portal links are cheap but not free, and each one is a round trip to
   Stripe. */
const byUser = new RateLimiter(BILLING_LIMIT);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  /* Before anything else: a preflight from the native shell carries no
     Authorization header, and everything below expects one. */
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const userId = await authenticateUser(req);

    /* Keyed on the user rather than the address: the route is authenticated, so
       there is a better key than an IP, and a shared office should not share a
       billing allowance. */
    if (!byUser.allow(userId)) {
      return tooManyRequests(
        res,
        byUser.retryAfterSeconds(userId),
        'Too many billing requests. Try again in a minute.'
      );
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();

    if (!profile?.stripe_customer_id) {
      return res.status(400).json({ message: 'No subscription found' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${getAppUrl(req)}/pricing`,
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('Portal error:', error);
    return res.status(error instanceof AuthError ? 401 : 500).json({ message });
  }
}
