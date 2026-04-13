import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// Tier configuration — duplicated from src/types/billing.types.ts
// to avoid importing client-side code into serverless functions
const TIER_LIMITS = {
  free: {
    storage_limit: 500 * 1024 * 1024, // 500 MB
    allowed_providers: ['cloudinary', 'r2', 'supabase_storage', 'googledrive'],
  },
  pro: {
    storage_limit: 5 * 1024 * 1024 * 1024, // 5 GB
    allowed_providers: ['cloudinary', 'r2', 'supabase_storage', 'googledrive', 'dropbox'],
  },
} as const;

async function buffer(readable: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function upgradeToPro(customerId: string, subscriptionId: string, periodEnd: Date) {
  const { error, count } = await supabase
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
    .select('id', { count: 'exact', head: true });

  if (error) throw new Error(`Failed to upgrade: ${error.message}`);
  if (!count) throw new Error(`No profile found for customer ${customerId}`);
}

async function downgradeToFree(customerId: string) {
  const { error, count } = await supabase
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
    .select('id', { count: 'exact', head: true });

  if (error) throw new Error(`Failed to downgrade: ${error.message}`);
  if (!count) throw new Error(`No profile found for customer ${customerId}`);
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
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.subscription && session.customer) {
          const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
          await upgradeToPro(
            session.customer as string,
            subscription.id,
            new Date(subscription.current_period_end * 1000)
          );
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        if (subscription.status === 'active') {
          await upgradeToPro(
            customerId,
            subscription.id,
            new Date(subscription.current_period_end * 1000)
          );
        } else if (subscription.status === 'past_due') {
          const { error } = await supabase
            .from('profiles')
            .update({ subscription_status: 'past_due' })
            .eq('stripe_customer_id', customerId);
          if (error) throw new Error(`Failed to update status: ${error.message}`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await downgradeToFree(subscription.customer as string);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.customer) {
          const { error } = await supabase
            .from('profiles')
            .update({ subscription_status: 'past_due' })
            .eq('stripe_customer_id', invoice.customer as string);
          if (error) throw new Error(`Failed to update payment status: ${error.message}`);
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
