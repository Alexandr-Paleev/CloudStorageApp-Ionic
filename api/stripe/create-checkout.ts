import type { VercelRequest, VercelResponse } from '../../libs/server/src/vercel';
import Stripe from 'stripe';
import { authenticate, AuthError, supabase } from '../../libs/server/src/auth';
import { isDemoEmail } from '../../libs/server/src/demo';
import { holdsASubscription, isLiveKey } from '../../libs/server/src/stripe';
import { report } from '../../libs/server/src/report';
import { getAppUrl } from '../../libs/server/src/app-url';
import { applyCors } from '../../libs/server/src/cors';
import { BILLING_LIMIT, RateLimiter, tooManyRequests } from '../../libs/server/src/rate-limit';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

/* Each call here can create a Stripe customer, which is a row in an account
   this project does not control. */
const byUser = new RateLimiter(BILLING_LIMIT);

/* Room for a double click and a second tab, and no more: the customer and
   the session are both created under a key of the account and this window.
   Stripe keeps a key for a day at least and answers it with whatever it
   answered first, a failure included, so a key for the account alone would
   turn one failed create into a day of refused checkouts. */
const KEY_WINDOW_MS = 10 * 60 * 1000;

/**
 * The account's Stripe customer, created where it has none, and only once.
 *
 * Two checkouts started together each used to create one. The profile kept
 * the one stored last, but both sessions stayed open, and a subscription paid
 * for in the other found no profile: the webhook answered 500 for the three
 * days Stripe retries, and Pro never came. Now a create repeated with the
 * same idempotency key gets back the customer the first one made, and the id
 * is stored only where none is yet, so a checkout that loses the race takes
 * the winner's.
 */
async function customerFor(userId: string, email: string | null, slot: number): Promise<string> {
  const customer = await stripe.customers.create(
    { email: email ?? undefined, metadata: { supabase_user_id: userId } },
    // The account's id, which the customer's metadata holds anyway: the key
    // tells Stripe nothing it is not already told.
    { idempotencyKey: `customer-${userId}-${slot}` }
  );

  // Cannot be swallowed: without this id the webhook has no way to find the
  // profile later, and a paid subscription would never be applied.
  const { data: stored, error: updateError } = await supabase
    .from('profiles')
    .update({ stripe_customer_id: customer.id })
    .eq('id', userId)
    .is('stripe_customer_id', null)
    .select('id');

  if (updateError) {
    throw new Error(`Failed to store Stripe customer id: ${updateError.message}`);
  }
  if (stored?.length) return customer.id;

  const { data: winner, error: readError } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', userId)
    .single();

  if (readError || !winner?.stripe_customer_id) {
    throw new Error(
      `Failed to read the Stripe customer id another checkout stored: ${readError?.message ?? 'none'}`
    );
  }

  /* Made in another window than the winner's, so a customer of its own. It
     holds the account's email and nothing else, and deleting the account
     would never find it. */
  if (winner.stripe_customer_id !== customer.id) {
    try {
      await stripe.customers.del(customer.id);
    } catch (error) {
      console.warn(`Checkout: could not delete the extra customer ${customer.id}:`, error);
      await report(error, {
        route: 'stripe/checkout',
        userId,
        level: 'warning',
        extra: { customer: customer.id },
      });
    }
  }
  return winner.stripe_customer_id;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  /* Before anything else: a preflight from the native shell carries no
     Authorization header, and everything below expects one. */
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // Outside the try, so that a failure is reported with the account it was for.
  let userId: string | undefined;

  try {
    const user = await authenticate(req);
    userId = user.id;

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

    /* A demo account is erased a day after it was made, and the erase ends
       its subscription at once and refunds nothing: on a live key, whoever
       paid would get a day of the month they paid for. In test mode a
       checkout costs nothing, and paying with a test card is part of what the
       demo is there to show: only a live key refuses it. */
    if (isDemoEmail(user.email) && isLiveKey(process.env.STRIPE_SECRET_KEY)) {
      return res
        .status(403)
        .json({ message: 'A demo account cannot subscribe. Create an account to buy Pro.' });
    }

    const appUrl = getAppUrl(req);

    // Get or create Stripe customer
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('stripe_customer_id, email')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      throw new Error(
        `No profile row for user ${userId} — has migrations/001_add_profiles_and_billing.sql been run?`
      );
    }

    // One window for both keys, read once, so that they agree.
    const slot = Math.floor(Date.now() / KEY_WINDOW_MS);

    const customerId: string =
      profile.stripe_customer_id ?? (await customerFor(userId, profile.email, slot));

    // The client hides the upgrade button for Pro users, but this route is
    // reachable directly — without this check a second checkout creates a
    // second subscription and Stripe bills for both. Not only an active one
    // (see holdsASubscription); the client takes a 409 to the portal, where a
    // failed card is fixed. Without a status, Stripe lists every subscription
    // that has not been cancelled.
    const { data: subscriptions } = await stripe.subscriptions.list({
      customer: customerId,
      limit: 100,
    });

    if (subscriptions.some(holdsASubscription)) {
      return res.status(409).json({ message: 'Subscription already active' });
    }

    /* Under a key, as the customer is. Two checkouts started together each
       opened a session of their own, and each could be paid: two
       subscriptions on one customer, both billed. Now a second one in the
       same window gets the session the first opened, and a session is paid
       once. */
    const session = await stripe.checkout.sessions.create(
      {
        customer: customerId,
        mode: 'subscription',
        line_items: [
          {
            price: process.env.STRIPE_PRICE_ID_PRO_MONTHLY!,
            quantity: 1,
          },
        ],
        /* A path and nothing after it. This used to end in
           `?session_id={CHECKOUT_SESSION_ID}`, which nothing in the app ever
           read: the page it leads to asks for the profile again, and the tier
           is written by the webhook. What it did do was put the id of a
           payment into an address the app's analytics were then told. An
           address carries what something reads, and nothing more: decision
           0015. */
        success_url: `${appUrl}/subscription/success`,
        cancel_url: `${appUrl}/pricing`,
        metadata: { supabase_user_id: userId },
      },
      { idempotencyKey: `checkout-${userId}-${slot}` }
    );

    return res.status(200).json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('Checkout error:', error);
    if (!(error instanceof AuthError)) await report(error, { route: 'stripe/checkout', userId });
    return res.status(error instanceof AuthError ? 401 : 500).json({ message });
  }
}
