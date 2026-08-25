import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { authenticateUser, AuthError, supabase } from '../../lib/auth';
import { getAppUrl } from '../../lib/app-url';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const userId = await authenticateUser(req);
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

    let customerId = profile.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: profile.email ?? undefined,
        metadata: { supabase_user_id: userId },
      });
      customerId = customer.id;

      // Cannot be swallowed: without this id the webhook has no way to find the
      // profile later, and a paid subscription would never be applied.
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', userId);

      if (updateError) {
        throw new Error(`Failed to store Stripe customer id: ${updateError.message}`);
      }
    }

    // The client hides the upgrade button for Pro users, but this route is
    // reachable directly — without this check a second checkout creates a
    // second subscription and Stripe bills for both.
    const activeSubscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 1,
    });

    if (activeSubscriptions.data.length > 0) {
      return res.status(409).json({ message: 'Subscription already active' });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID_PRO_MONTHLY!,
          quantity: 1,
        },
      ],
      success_url: `${appUrl}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/pricing`,
      metadata: { supabase_user_id: userId },
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('Checkout error:', error);
    return res.status(error instanceof AuthError ? 401 : 500).json({ message });
  }
}
