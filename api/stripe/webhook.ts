import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { getPeriodEnd } from '../../libs/server/src/stripe';
import { TIER_LIMITS } from '../../libs/core/src/tiers';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function buffer(readable: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function upgradeToPro(customerId: string, subscriptionId: string, periodEnd: Date) {
  const { data, error } = await supabase
    .from('profiles')
    .update({
      tier: 'pro',
      storage_limit: TIER_LIMITS.pro.storage_limit,
      stripe_subscription_id: subscriptionId,
      subscription_status: 'active',
      subscription_period_end: periodEnd.toISOString(),
      allowed_providers: TIER_LIMITS.pro.allowed_providers,
    })
    .eq('stripe_customer_id', customerId)
    .select('id');

  if (error) throw new Error(`Failed to upgrade: ${error.message}`);
  if (!data?.length) throw new Error(`No profile found for customer ${customerId}`);
}

async function downgradeToFree(customerId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .update({
      tier: 'free',
      storage_limit: TIER_LIMITS.free.storage_limit,
      stripe_subscription_id: null,
      subscription_status: 'canceled',
      subscription_period_end: null,
      allowed_providers: TIER_LIMITS.free.allowed_providers,
    })
    .eq('stripe_customer_id', customerId)
    .select('id');

  if (error) throw new Error(`Failed to downgrade: ${error.message}`);
  if (!data?.length) throw new Error(`No profile found for customer ${customerId}`);
}

async function markPastDue(customerId: string) {
  const { error } = await supabase
    .from('profiles')
    .update({ subscription_status: 'past_due' })
    .eq('stripe_customer_id', customerId);

  if (error) throw new Error(`Failed to update status: ${error.message}`);
}

/**
 * Brings one customer's profile in line with what Stripe holds now.
 *
 * Every event below is read as "something changed for this customer", never as
 * a description of what to write. Stripe does not deliver events in the order
 * they happened, and retries a failed delivery for up to three days, so the
 * subscription inside an event is a snapshot of some earlier moment. Read
 * literally, a late `customer.subscription.updated` saying "active" put an
 * account back on Pro for good after the cancellation that followed it; the
 * late end of an old subscription took Pro from someone already paying for a
 * new one; a late payment failure marked past_due an account a retry had
 * already paid for. Asking Stripe each time makes order and duplicates
 * irrelevant: whichever event is handled last writes the state as it is.
 *
 * The rules are the ones the handlers applied to the snapshot, applied to the
 * current state instead: an active subscription is Pro; past_due is recorded
 * and the tier left alone; a cancelled one, with nothing live beside it, is
 * Free; anything else — an `incomplete` checkout still being paid, say —
 * changes nothing.
 */
async function syncCustomer(customerId: string) {
  // Newest first, as Stripe lists them; `all` so that cancelled ones count.
  const { data } = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 10,
  });

  const active = data.find((subscription) => subscription.status === 'active');

  if (active) {
    await upgradeToPro(customerId, active.id, getPeriodEnd(active));
  } else if (data.some((subscription) => subscription.status === 'past_due')) {
    await markPastDue(customerId);
  } else if (data.some((subscription) => subscription.status === 'canceled')) {
    await downgradeToFree(customerId);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'] as string;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return res.status(400).json({ message: 'Invalid signature' });
  }

  try {
    // Each case only works out which customer to ask about — see syncCustomer
    // for why the event's own copy of the subscription is not used.
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.subscription && session.customer) {
          await syncCustomer(session.customer as string);
        }
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await syncCustomer(subscription.customer as string);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.customer) {
          await syncCustomer(invoice.customer as string);
        }
        break;
      }
    }

    return res.status(200).json({ received: true });
  } catch (handlerError) {
    console.error('Webhook handler error:', handlerError);
    return res.status(500).json({ message: 'Webhook handler failed' });
  }
}
