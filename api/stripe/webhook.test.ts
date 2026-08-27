import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  mockRawRequest,
  mockResponse,
  mockSupabase,
  type RecordedCall,
  type TableAnswer,
} from '../../lib/test-utils';
import { TIER_LIMITS } from '../../lib/tiers';

const { db, stripe } = vi.hoisted(() => ({
  db: {
    client: null as { from: (table: string) => unknown } | null,
    calls: [] as { table: string; op: string; args?: unknown[] }[],
  },
  stripe: {
    constructEvent: vi.fn(),
    retrieveSubscription: vi.fn(),
  },
}));

vi.mock('../../lib/auth', () => ({
  AuthError: class extends Error {},
  authenticateUser: vi.fn(),
  supabase: { from: (table: string) => db.client!.from(table) },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => db.client!.from(table) }),
}));

vi.mock('stripe', () => ({
  default: class {
    webhooks = { constructEvent: stripe.constructEvent };
    subscriptions = { retrieve: stripe.retrieveSubscription };
  },
}));

import handler from './webhook';

const CUSTOMER = 'cus_test';
const PERIOD_END = 1790331343; // seconds since epoch, as Stripe sends it

/** A subscription shaped the way API 2025-03-31.basil onwards returns it:
 *  current_period_end lives on the item, not on the subscription. */
function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_test',
    customer: CUSTOMER,
    status: 'active',
    items: { data: [{ current_period_end: PERIOD_END }] },
    ...overrides,
  };
}

function withProfiles(answer: TableAnswer = { data: [{ id: 'profile-1' }] }) {
  const mock = mockSupabase({ profiles: answer });
  db.client = mock.client;
  db.calls = mock.calls;
}

/** The payload of the last .update() — what the handler actually wrote. */
function lastUpdate(): Record<string, unknown> | undefined {
  const writes = (db.calls as RecordedCall[]).filter((c) => c.op === 'update');
  return writes.at(-1)?.args?.[0] as Record<string, unknown> | undefined;
}

function post() {
  return mockRawRequest('{"raw":"body"}', {
    headers: { 'stripe-signature': 'sig_test' },
  });
}

function deliver(type: string, object: unknown) {
  stripe.constructEvent.mockReturnValue({ type, data: { object } });
}

beforeEach(() => {
  vi.clearAllMocks();
  withProfiles();
  stripe.retrieveSubscription.mockResolvedValue(subscription());
  deliver('unknown.event', {});
});

describe('webhook: signature', () => {
  it('refuses anything but POST', async () => {
    const res = mockResponse();
    await handler(mockRawRequest('', { method: 'GET' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('rejects an event whose signature does not verify', async () => {
    stripe.constructEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature');
    });
    const res = mockResponse();
    await handler(post(), res);

    expect(res.statusCode).toBe(400);
    expect(db.calls).toHaveLength(0);
  });

  it('verifies against the raw bytes, not a parsed body', async () => {
    // Re-serialising JSON would change the bytes and break every signature.
    await handler(post(), mockResponse());

    const [payload] = stripe.constructEvent.mock.calls[0] as [Buffer];
    expect(Buffer.isBuffer(payload)).toBe(true);
    expect(payload.toString()).toBe('{"raw":"body"}');
  });
});

describe('webhook: checkout completed', () => {
  beforeEach(() => {
    deliver('checkout.session.completed', { subscription: 'sub_test', customer: CUSTOMER });
  });

  it('puts the account on Pro', async () => {
    const res = mockResponse();
    await handler(post(), res);

    expect(res.statusCode).toBe(200);
    expect(lastUpdate()).toMatchObject({
      tier: 'pro',
      subscription_status: 'active',
      stripe_subscription_id: 'sub_test',
      storage_limit: TIER_LIMITS.pro.storage_limit,
    });
  });

  it('grants the Pro provider list, Dropbox included', async () => {
    await handler(post(), mockResponse());
    expect(lastUpdate()?.allowed_providers).toContain('dropbox');
  });

  it('stores a real period end, taken from the subscription item', async () => {
    // The bug this guards: Stripe moved current_period_end onto items, and
    // reading the old field produced an Invalid Date that threw on write.
    await handler(post(), mockResponse());

    const stored = lastUpdate()?.subscription_period_end as string;
    expect(stored).toBe(new Date(PERIOD_END * 1000).toISOString());
    expect(stored).not.toContain('Invalid');
  });

  it('fails loudly when the subscription carries no period end', async () => {
    stripe.retrieveSubscription.mockResolvedValue(subscription({ items: { data: [{}] } }));
    const res = mockResponse();
    await handler(post(), res);

    expect(res.statusCode).toBe(500);
  });

  it('ignores a session that has no subscription attached', async () => {
    deliver('checkout.session.completed', { customer: CUSTOMER });
    const res = mockResponse();
    await handler(post(), res);

    expect(res.statusCode).toBe(200);
    expect(db.calls).toHaveLength(0);
  });

  it('reports failure when no profile matches the customer', async () => {
    // Returning 200 here would let Stripe consider a lost upgrade delivered.
    withProfiles({ data: [] });
    const res = mockResponse();
    await handler(post(), res);

    expect(res.statusCode).toBe(500);
  });

  it('reports failure when the write itself errors', async () => {
    withProfiles({ error: { message: 'connection reset' } });
    const res = mockResponse();
    await handler(post(), res);

    expect(res.statusCode).toBe(500);
  });
});

describe('webhook: subscription updated', () => {
  it('upgrades on an active subscription', async () => {
    deliver('customer.subscription.updated', subscription());
    await handler(post(), mockResponse());
    expect(lastUpdate()).toMatchObject({ tier: 'pro' });
  });

  it('marks a past_due subscription without touching the tier', async () => {
    deliver('customer.subscription.updated', subscription({ status: 'past_due' }));
    const res = mockResponse();
    await handler(post(), res);

    expect(res.statusCode).toBe(200);
    expect(lastUpdate()).toEqual({ subscription_status: 'past_due' });
  });

  it('leaves other statuses alone', async () => {
    deliver('customer.subscription.updated', subscription({ status: 'incomplete' }));
    const res = mockResponse();
    await handler(post(), res);

    expect(res.statusCode).toBe(200);
    expect(db.calls).toHaveLength(0);
  });
});

describe('webhook: subscription cancelled', () => {
  beforeEach(() => deliver('customer.subscription.deleted', subscription()));

  it('drops the account back to Free', async () => {
    const res = mockResponse();
    await handler(post(), res);

    expect(res.statusCode).toBe(200);
    expect(lastUpdate()).toMatchObject({
      tier: 'free',
      subscription_status: 'canceled',
      storage_limit: TIER_LIMITS.free.storage_limit,
      stripe_subscription_id: null,
      subscription_period_end: null,
    });
  });

  it('takes Dropbox away with the paid tier', async () => {
    await handler(post(), mockResponse());
    expect(lastUpdate()?.allowed_providers).not.toContain('dropbox');
  });
});

describe('webhook: payment failed', () => {
  it('marks the subscription past_due', async () => {
    deliver('invoice.payment_failed', { customer: CUSTOMER });
    const res = mockResponse();
    await handler(post(), res);

    expect(res.statusCode).toBe(200);
    expect(lastUpdate()).toEqual({ subscription_status: 'past_due' });
  });

  it('ignores an invoice with no customer', async () => {
    deliver('invoice.payment_failed', {});
    const res = mockResponse();
    await handler(post(), res);

    expect(res.statusCode).toBe(200);
    expect(db.calls).toHaveLength(0);
  });
});

describe('webhook: unhandled events', () => {
  it('acknowledges them without writing anything', async () => {
    // Stripe retries anything that is not 2xx, so an unknown type must not 500.
    deliver('customer.subscription.trial_will_end', subscription());
    const res = mockResponse();
    await handler(post(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true });
    expect(db.calls).toHaveLength(0);
  });
});
