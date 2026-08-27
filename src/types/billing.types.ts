import { TIER_LIMITS } from '../../lib/tiers';

export type SubscriptionTier = 'free' | 'pro';

export type SubscriptionStatus = 'inactive' | 'active' | 'past_due' | 'canceled' | 'trialing';

export interface UserProfile {
  id: string;
  email: string | null;
  display_name: string | null;
  tier: SubscriptionTier;
  storage_limit: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: SubscriptionStatus;
  subscription_period_end: string | null;
  allowed_providers: string[];
  created_at: string;
  updated_at: string;
}

/** Presentation on top of the shared limits — names, prices and copy are the
 *  client's business; the numbers are not. */
export const TIER_CONFIG = {
  free: {
    name: 'Free',
    ...TIER_LIMITS.free,
    price: 0,
    features: [
      '500 MB storage',
      'Auto provider selection',
      'Google Drive overflow',
      'Basic analytics',
    ],
  },
  pro: {
    name: 'Pro',
    ...TIER_LIMITS.pro,
    price: 900, // $9.00 in cents
    features: [
      '5 GB storage',
      'All providers + Dropbox',
      'Choose upload provider',
      'Priority support',
    ],
  },
} as const;
