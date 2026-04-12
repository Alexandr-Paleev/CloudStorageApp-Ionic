import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { authenticateUser, supabase } from '../lib/auth';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const userId = await authenticateUser(req);

    // Get or create Stripe customer
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id, email')
      .eq('id', userId)
      .single();

    let customerId = profile?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: profile?.email ?? undefined,
        metadata: { supabase_user_id: userId },
      });
      customerId = customer.id;

      await supabase.from('profiles').update({ stripe_customer_id: customerId }).eq('id', userId);
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
      success_url: `${req.headers.origin}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin}/pricing`,
      metadata: { supabase_user_id: userId },
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message.includes('token') ? 401 : 500;
    console.error('Checkout error:', error);
    return res.status(status).json({ message });
  }
}
