import { supabase } from '../supabase/supabase.config';
import { UserProfile } from '../types/billing.types';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return {
    'Content-Type': 'application/json',
    ...(session?.access_token && { Authorization: `Bearer ${session.access_token}` }),
  };
}

/** Thrown when checkout is refused because the user is already subscribed. */
export class SubscriptionExistsError extends Error {
  constructor(message = 'Subscription already active') {
    super(message);
    this.name = 'SubscriptionExistsError';
  }
}

const billingService = {
  async getProfile(userId: string): Promise<UserProfile | null> {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();

    if (error) {
      if (error.code === 'PGRST116') return null; // not found
      throw error;
    }

    return data as UserProfile;
  },

  async getStorageLimit(userId: string): Promise<number> {
    const profile = await this.getProfile(userId);
    return profile?.storage_limit ?? 500 * 1024 * 1024;
  },

  isProviderAllowed(profile: UserProfile | null, provider: string): boolean {
    if (!profile) return ['cloudinary', 'r2', 'supabase_storage', 'googledrive'].includes(provider);
    return profile.allowed_providers.includes(provider);
  },

  async createCheckoutSession(): Promise<string> {
    const headers = await getAuthHeaders();
    const response = await fetch('/api/stripe/create-checkout', {
      method: 'POST',
      headers,
    });

    if (!response.ok) {
      const error = await response.json();
      if (response.status === 409) {
        throw new SubscriptionExistsError(error.message);
      }
      throw new Error(error.message || 'Failed to create checkout session');
    }

    const { url } = await response.json();
    return url;
  },

  async createPortalSession(): Promise<string> {
    const headers = await getAuthHeaders();
    const response = await fetch('/api/stripe/create-portal', {
      method: 'POST',
      headers,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to create portal session');
    }

    const { url } = await response.json();
    return url;
  },
};

export default billingService;
