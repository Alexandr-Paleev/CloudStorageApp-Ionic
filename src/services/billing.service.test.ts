import { describe, it, expect, beforeEach, vi } from 'vitest';
import billingService, { SubscriptionExistsError } from './billing.service';
import { DEFAULT_STORAGE_LIMIT, TIER_LIMITS } from '../../lib/tiers';
import type { UserProfile } from '../types/billing.types';

const getSession = vi.fn();
const single = vi.fn();

vi.mock('../supabase/supabase.config', () => ({
  supabase: {
    auth: { getSession: () => getSession() },
    from: () => ({ select: () => ({ eq: () => ({ single: () => single() }) }) }),
  },
}));

const fetchMock = vi.fn();

const profile = (over: Partial<UserProfile> = {}) =>
  ({
    id: 'user-1',
    tier: 'pro',
    storage_limit: TIER_LIMITS.pro.storage_limit,
    allowed_providers: [...TIER_LIMITS.pro.allowed_providers],
    ...over,
  }) as UserProfile;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  getSession.mockResolvedValue({ data: { session: { access_token: 'jwt' } } });
  single.mockResolvedValue({ data: profile(), error: null });
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ url: 'https://s' }) });
});

describe('reading the profile', () => {
  /* PGRST116 is "no rows". An account that has not been through the billing
     table yet is a state, not a failure — treating it as one would put an error
     screen in front of every user whose profile row is a moment behind. */
  it('answers null for an account with no profile row', async () => {
    single.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });
    await expect(billingService.getProfile('user-1')).resolves.toBeNull();
  });

  it('rethrows any other database error', async () => {
    single.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } });
    await expect(billingService.getProfile('user-1')).rejects.toMatchObject({ code: '42501' });
  });
});

/**
 * What an unknown account is allowed to do.
 *
 * Both of these fall back, and both fall back *down*. A read that fails or a
 * row that is not there must never be read as more room or more providers than
 * the free tier — that is the difference between a degraded experience and
 * giving away the paid one.
 */
describe('what happens when the profile is unknown', () => {
  it('falls back to the free limit, not to the Pro one', async () => {
    single.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });

    await expect(billingService.getStorageLimit('user-1')).resolves.toBe(DEFAULT_STORAGE_LIMIT);
    expect(DEFAULT_STORAGE_LIMIT).toBe(TIER_LIMITS.free.storage_limit);
  });

  it('allows only what the free tier allows', () => {
    for (const provider of TIER_LIMITS.free.allowed_providers) {
      expect(billingService.isProviderAllowed(null, provider), provider).toBe(true);
    }

    const proOnly = TIER_LIMITS.pro.allowed_providers.filter(
      (p) => !(TIER_LIMITS.free.allowed_providers as readonly string[]).includes(p)
    );
    expect(proOnly.length).toBeGreaterThan(0);
    for (const provider of proOnly) {
      expect(billingService.isProviderAllowed(null, provider), provider).toBe(false);
    }
  });

  it('uses the profile once there is one', () => {
    expect(billingService.isProviderAllowed(profile(), 'dropbox')).toBe(true);
    expect(
      billingService.isProviderAllowed(profile({ allowed_providers: ['r2'] }), 'dropbox')
    ).toBe(false);
  });
});

describe('starting a checkout', () => {
  it('carries the session token, since the route mints a session for whoever asks', async () => {
    await billingService.createCheckoutSession();

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).method).toBe('POST');
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer jwt');
  });

  it('sends no Authorization header when there is no session', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    await billingService.createCheckoutSession();

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as { headers: Record<string, string> }).headers).not.toHaveProperty(
      'Authorization'
    );
  });

  /* 409 has to stay distinguishable all the way to the UI. Flattened into a
     generic Error it reads as "checkout is broken", and the honest answer —
     "you already pay for this" — is the one that stops someone buying a second
     subscription. */
  it('turns 409 into an error the interface can recognise', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ message: 'Subscription already active' }),
    });

    await expect(billingService.createCheckoutSession()).rejects.toBeInstanceOf(
      SubscriptionExistsError
    );
  });

  it('reports the server’s message for any other refusal', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: 'Stripe is down' }),
    });

    await expect(billingService.createCheckoutSession()).rejects.toThrow('Stripe is down');
  });

  it('returns the URL to send the browser to', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' }),
    });

    await expect(billingService.createCheckoutSession()).resolves.toBe(
      'https://checkout.stripe.com/c/pay/cs_test_1'
    );
  });
});

describe('opening the billing portal', () => {
  it('returns the portal URL', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ url: 'https://billing.stripe.com/p/session_1' }),
    });

    await expect(billingService.createPortalSession()).resolves.toBe(
      'https://billing.stripe.com/p/session_1'
    );
  });

  it('reports why the portal could not be opened', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: 'No such customer' }),
    });

    await expect(billingService.createPortalSession()).rejects.toThrow('No such customer');
  });
});
