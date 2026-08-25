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

export const TIER_CONFIG = {
  free: {
    name: 'Free',
    storage_limit: 500 * 1024 * 1024, // 500 MB
    allowed_providers: ['cloudinary', 'r2', 'supabase_storage', 'googledrive'],
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
    storage_limit: 5 * 1024 * 1024 * 1024, // 5 GB
    allowed_providers: ['cloudinary', 'r2', 'supabase_storage', 'googledrive', 'dropbox'],
    price: 900, // $9.00 in cents
    features: [
      '5 GB storage',
      'All providers + Dropbox',
      'Choose upload provider',
      'Priority support',
    ],
  },
} as const;
