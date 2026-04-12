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
      return_url: `${req.headers.origin}/pricing`,
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message.includes('token') ? 401 : 500;
    console.error('Portal error:', error);
    return res.status(status).json({ message });
  }
}
