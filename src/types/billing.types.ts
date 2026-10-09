import { PLANS } from '@cloud-storage/core/plans';
import { TIER_LIMITS } from '@cloud-storage/core/tiers';

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

/** Each plan as the shared library describes it, with the limits it enforces.
 *  The names, the price and the copy used to be written here; the site shows
 *  them too now, so they are in `libs/core` and this only puts the two
 *  halves side by side. */
export const TIER_CONFIG = {
  free: { ...PLANS.free, ...TIER_LIMITS.free },
  pro: { ...PLANS.pro, ...TIER_LIMITS.pro },
} as const;
