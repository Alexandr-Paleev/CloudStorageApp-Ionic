import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockRequest, mockResponse, mockSupabase, type TableAnswer } from '../../lib/test-utils';

const APP_URL = 'https://app.example';

const { FakeAuthError, authenticateUser, db, stripe } = vi.hoisted(() => ({
  FakeAuthError: class FakeAuthError extends Error {},
  authenticateUser: vi.fn(),
  db: { client: null as { from: (table: string) => unknown } | null },
  stripe: {
    listSubscriptions: vi.fn(),
    createSession: vi.fn(),
    createCustomer: vi.fn(),
  },
}));

vi.mock('../../lib/auth', () => ({
  AuthError: FakeAuthError,
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
  supabase: { from: (table: string) => db.client!.from(table) },
}));

vi.mock('stripe', () => ({
  default: class {
    subscriptions = { list: stripe.listSubscriptions };
    checkout = { sessions: { create: stripe.createSession } };
    customers = { create: stripe.createCustomer };
  },
}));

import handler from './create-checkout';

function profileRow(row: Record<string, unknown> | null): TableAnswer {
  return { data: row ? [row] : [] };
}

const KNOWN_CUSTOMER = { stripe_customer_id: 'cus_existing', email: 'a@example.com' };

function withProfile(row: Record<string, unknown> | null) {
  db.client = mockSupabase({ profiles: profileRow(row) }).client;
}

function request() {
  return mockRequest({ headers: { authorization: 'Bearer t', origin: APP_URL } });
}

beforeEach(() => {
  vi.clearAllMocks();
  authenticateUser.mockResolvedValue('user-1');
  withProfile(KNOWN_CUSTOMER);
  stripe.listSubscriptions.mockResolvedValue({ data: [] });
  stripe.createSession.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
  stripe.createCustomer.mockResolvedValue({ id: 'cus_new' });
});

describe('create-checkout: access', () => {
  it('refuses anything but POST', async () => {
    const res = mockResponse();
    await handler(mockRequest({ method: 'GET' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('answers 401 when the caller is not authenticated', async () => {
    authenticateUser.mockRejectedValue(new FakeAuthError('Invalid or expired token'));
    const res = mockResponse();
    await handler(request(), res);
    expect(res.statusCode).toBe(401);
    expect(stripe.createSession).not.toHaveBeenCalled();
  });

  it('does not start a checkout when the profile row is missing', async () => {
    withProfile(null);
    const res = mockResponse();
    await handler(request(), res);

    expect(res.statusCode).toBe(500);
    expect((res.body as { message: string }).message).toMatch(/No profile row/);
    expect(stripe.createSession).not.toHaveBeenCalled();
  });
});

describe('create-checkout: duplicate subscriptions', () => {
  it('refuses with 409 when a subscription is already active', async () => {
    // The client hides the upgrade button for Pro users, but this route is
    // reachable directly — four live subscriptions on one customer is how this
    // was found.
    stripe.listSubscriptions.mockResolvedValue({ data: [{ id: 'sub_live' }] });
    const res = mockResponse();
    await handler(request(), res);

    expect(res.statusCode).toBe(409);
    expect(stripe.createSession).not.toHaveBeenCalled();
  });

  it('asks Stripe about the caller, not about subscriptions in general', async () => {
    await handler(request(), mockResponse());
    expect(stripe.listSubscriptions).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_existing', status: 'active' })
    );
  });

  it('checks before creating the session, not after', async () => {
    stripe.listSubscriptions.mockResolvedValue({ data: [{ id: 'sub_live' }] });
    await handler(request(), mockResponse());
    expect(stripe.listSubscriptions).toHaveBeenCalled();
    expect(stripe.createSession).not.toHaveBeenCalled();
  });
});

describe('create-checkout: the session', () => {
  it('returns the Stripe URL for a user with no active subscription', async () => {
    const res = mockResponse();
    await handler(request(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
  });

  it('bills the existing customer instead of making a second one', async () => {
    await handler(request(), mockResponse());

    expect(stripe.createCustomer).not.toHaveBeenCalled();
    expect(stripe.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_existing', mode: 'subscription' })
    );
  });

  it('creates a customer when the profile has none yet', async () => {
    withProfile({ stripe_customer_id: null, email: 'new@example.com' });
    await handler(request(), mockResponse());

    expect(stripe.createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { supabase_user_id: 'user-1' } })
    );
    expect(stripe.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_new' })
    );
  });

  it('sends the user back to this deployment, not to a fixed host', async () => {
    await handler(request(), mockResponse());

    const [args] = stripe.createSession.mock.calls[0] as [Record<string, string>];
    expect(args.success_url.startsWith(APP_URL)).toBe(true);
    expect(args.cancel_url.startsWith(APP_URL)).toBe(true);
  });

  it('carries the user id into the session metadata', async () => {
    await handler(request(), mockResponse());
    expect(stripe.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { supabase_user_id: 'user-1' } })
    );
  });
});
