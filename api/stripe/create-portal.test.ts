import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockRequest, mockResponse, mockSupabase } from '../../lib/test-utils';

const APP_URL = 'https://app.example';

const { FakeAuthError, authenticateUser, db, createPortalSession } = vi.hoisted(() => ({
  FakeAuthError: class FakeAuthError extends Error {},
  authenticateUser: vi.fn(),
  db: { client: null as { from: (t: string) => unknown } | null },
  createPortalSession: vi.fn(),
}));

vi.mock('../../lib/auth', () => ({
  AuthError: FakeAuthError,
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
  supabase: { from: (table: string) => db.client!.from(table) },
}));

vi.mock('stripe', () => ({
  default: class {
    billingPortal = { sessions: { create: createPortalSession } };
  },
}));

import handler from './create-portal';

function withProfile(row: Record<string, unknown> | null) {
  db.client = mockSupabase({ profiles: { data: row ? [row] : [] } }).client;
}

const post = () => mockRequest({ headers: { authorization: 'Bearer t', origin: APP_URL } });

beforeEach(() => {
  vi.clearAllMocks();
  authenticateUser.mockResolvedValue('user-1');
  withProfile({ stripe_customer_id: 'cus_1' });
  createPortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/session' });
});

describe('create-portal', () => {
  it('refuses anything but POST', async () => {
    const res = mockResponse();
    await handler(mockRequest({ method: 'GET' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('answers 401 when the caller is not authenticated', async () => {
    authenticateUser.mockRejectedValue(new FakeAuthError('no token'));
    const res = mockResponse();
    await handler(post(), res);

    expect(res.statusCode).toBe(401);
    expect(createPortalSession).not.toHaveBeenCalled();
  });

  it('returns the portal URL for a subscribed customer', async () => {
    const res = mockResponse();
    await handler(post(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ url: 'https://billing.stripe.com/session' });
  });

  it('opens the portal for the caller own customer', async () => {
    await handler(post(), mockResponse());
    expect(createPortalSession).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_1' })
    );
  });

  it('sends the user back to this deployment', async () => {
    await handler(post(), mockResponse());
    const [args] = createPortalSession.mock.calls[0] as [Record<string, string>];
    expect(args.return_url.startsWith(APP_URL)).toBe(true);
  });

  it('answers 400 when the profile has no Stripe customer', async () => {
    // Nothing to manage yet — the user never subscribed.
    withProfile({ stripe_customer_id: null });
    const res = mockResponse();
    await handler(post(), res);

    expect(res.statusCode).toBe(400);
    expect(createPortalSession).not.toHaveBeenCalled();
  });

  it('answers 400 when there is no profile row at all', async () => {
    withProfile(null);
    const res = mockResponse();
    await handler(post(), res);
    expect(res.statusCode).toBe(400);
  });

  it('reports a Stripe failure as 500', async () => {
    createPortalSession.mockRejectedValue(new Error('portal not configured'));
    const res = mockResponse();
    await handler(post(), res);
    expect(res.statusCode).toBe(500);
  });
});
