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
    listSubscriptions: vi.fn(),
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
    subscriptions = { list: stripe.listSubscriptions };
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

/** What Stripe holds for the customer now, newest first. The handler asks for
 *  this on every event, whatever the event itself says. */
function stripeHolds(...subscriptions: unknown[]) {
  stripe.listSubscriptions.mockResolvedValue({ data: subscriptions });
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
  stripeHolds(subscription());
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

  it("asks Stripe about the session's customer, cancelled subscriptions included", async () => {
    await handler(post(), mockResponse());

    expect(stripe.listSubscriptions).toHaveBeenCalledWith(
      expect.objectContaining({ customer: CUSTOMER, status: 'all' })
    );
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
    stripeHolds(subscription({ items: { data: [{}] } }));
    const res = mockResponse();
    await handler(post(), res);

    expect(res.statusCode).toBe(500);
  });

  it('ignores a session that has no subscription attached', async () => {
    deliver('checkout.session.completed', { customer: CUSTOMER });
    const res = mockResponse();
    await handler(post(), res);

    expect(res.statusCode).toBe(200);
    expect(stripe.listSubscriptions).not.toHaveBeenCalled();
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
  it('upgrades when Stripe holds an active subscription', async () => {
    deliver('customer.subscription.updated', subscription());
    await handler(post(), mockResponse());
    expect(lastUpdate()).toMatchObject({ tier: 'pro' });
  });

  it('marks a past_due subscription without touching the tier', async () => {
    stripeHolds(subscription({ status: 'past_due' }));
    deliver('customer.subscription.updated', subscription({ status: 'past_due' }));
    const res = mockResponse();
    await handler(post(), res);

    expect(res.statusCode).toBe(200);
    expect(lastUpdate()).toEqual({ subscription_status: 'past_due' });
  });

  it('leaves a checkout that is still being paid alone', async () => {
    stripeHolds(subscription({ status: 'incomplete' }));
    deliver('customer.subscription.updated', subscription({ status: 'incomplete' }));
    const res = mockResponse();
    await handler(post(), res);

    expect(res.statusCode).toBe(200);
    expect(db.calls).toHaveLength(0);
  });

  it('does not let a late "active" snapshot undo the cancellation that followed it', async () => {
    // Stripe does not deliver in order and retries for days. Read literally,
    // this event put a cancelled account back on Pro, and nothing that came
    // after would ever take it away again.
    stripeHolds(subscription({ status: 'canceled' }));
    deliver('customer.subscription.updated', subscription({ status: 'active' }));
    await handler(post(), mockResponse());

    expect(lastUpdate()).toMatchObject({ tier: 'free', subscription_status: 'canceled' });
  });
});

describe('webhook: subscription cancelled', () => {
  beforeEach(() => {
    stripeHolds(subscription({ status: 'canceled' }));
    deliver('customer.subscription.deleted', subscription({ status: 'canceled' }));
  });

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

  it('does not take Pro from a newer subscription when an old one ends late', async () => {
    // Cancel, then subscribe again: if the old subscription's end is delivered
    // after the new one began, reading the event alone downgraded an account
    // that was paying.
    stripeHolds(
      subscription({ id: 'sub_new', status: 'active' }),
      subscription({ id: 'sub_old', status: 'canceled' })
    );
    deliver('customer.subscription.deleted', subscription({ id: 'sub_old', status: 'canceled' }));
    await handler(post(), mockResponse());

    expect(lastUpdate()).toMatchObject({ tier: 'pro', stripe_subscription_id: 'sub_new' });
  });
});

describe('webhook: payment failed', () => {
  it('marks the subscription past_due', async () => {
    stripeHolds(subscription({ status: 'past_due' }));
    deliver('invoice.payment_failed', { customer: CUSTOMER });
    const res = mockResponse();
    await handler(post(), res);

    expect(res.statusCode).toBe(200);
    expect(lastUpdate()).toEqual({ subscription_status: 'past_due' });
  });

  it('does not mark past_due an account that a later retry already paid for', async () => {
    deliver('invoice.payment_failed', { customer: CUSTOMER });
    await handler(post(), mockResponse());

    expect(lastUpdate()).toMatchObject({ tier: 'pro', subscription_status: 'active' });
  });

  it('ignores an invoice with no customer', async () => {
    deliver('invoice.payment_failed', {});
    const res = mockResponse();
    await handler(post(), res);

    expect(res.statusCode).toBe(200);
    expect(stripe.listSubscriptions).not.toHaveBeenCalled();
    expect(db.calls).toHaveLength(0);
  });
});

describe('webhook: when Stripe cannot be asked', () => {
  it('answers 500, so Stripe delivers the event again', async () => {
    // Writing nothing and saying 200 would lose the change for good.
    stripe.listSubscriptions.mockRejectedValue(new Error('api.stripe.com unreachable'));
    deliver('customer.subscription.updated', subscription());
    const res = mockResponse();
    await handler(post(), res);

    expect(res.statusCode).toBe(500);
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
    expect(stripe.listSubscriptions).not.toHaveBeenCalled();
    expect(db.calls).toHaveLength(0);
  });
});
