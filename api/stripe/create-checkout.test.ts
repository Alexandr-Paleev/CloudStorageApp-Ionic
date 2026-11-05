import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mockRequest,
  mockResponse,
  mockSupabase,
  type TableAnswer,
} from '../../libs/server/src/test-utils';

const APP_URL = 'https://app.example';

const { FakeAuthError, authenticate, db, stripe, report } = vi.hoisted(() => ({
  FakeAuthError: class FakeAuthError extends Error {},
  authenticate: vi.fn(),
  report: vi.fn(),
  db: {
    client: null as { from: (table: string) => unknown } | null,
    calls: [] as { table: string; op: string; args?: unknown[] }[],
  },
  stripe: {
    listSubscriptions: vi.fn(),
    createSession: vi.fn(),
    createCustomer: vi.fn(),
    deleteCustomer: vi.fn(),
  },
}));

vi.mock('../../libs/server/src/auth', () => ({
  AuthError: FakeAuthError,
  authenticate: (...args: unknown[]) => authenticate(...args),
  supabase: { from: (table: string) => db.client!.from(table) },
}));

vi.mock('stripe', () => ({
  default: class {
    subscriptions = { list: stripe.listSubscriptions };
    checkout = { sessions: { create: stripe.createSession } };
    customers = { create: stripe.createCustomer, del: stripe.deleteCustomer };
  },
}));

vi.mock('../../libs/server/src/report', () => ({
  report: (...args: unknown[]) => report(...args),
}));

import handler from './create-checkout';

function profileRow(row: Record<string, unknown> | null): TableAnswer {
  return { data: row ? [row] : [] };
}

const KNOWN_CUSTOMER = { stripe_customer_id: 'cus_existing', email: 'a@example.com' };

function withProfile(row: Record<string, unknown> | TableAnswer[] | null) {
  const mock = mockSupabase({ profiles: Array.isArray(row) ? row : profileRow(row) });
  db.client = mock.client;
  db.calls = mock.calls;
}

function request() {
  return mockRequest({ headers: { authorization: 'Bearer t', origin: APP_URL } });
}

/** What Stripe holds for the customer, listed the way Stripe lists it: by the
 *  status asked for, and without one, everything not cancelled. */
function stripeHolds(...subscriptions: { id: string; status: string }[]) {
  stripe.listSubscriptions.mockImplementation(async ({ status }: { status?: string }) => ({
    data: subscriptions.filter((subscription) =>
      status === undefined
        ? subscription.status !== 'canceled'
        : status === 'all' || subscription.status === status
    ),
  }));
}

/* One caller per test. The billing limiter allows six a minute and keys on the
   user, so a file that signs every test in as the same person starts handing
   out 429s partway down — a failure that moves as tests are added rather than
   pointing at what broke. */
let signedIn = 'user-0';
let callers = 0;

beforeEach(() => {
  vi.clearAllMocks();
  // getAppUrl takes an Origin only when it is this deployment's own address.
  process.env.VERCEL_PROJECT_PRODUCTION_URL = 'app.example';
  callers += 1;
  signedIn = `user-${callers}`;
  authenticate.mockResolvedValue({ id: signedIn, email: 'person@company.com' });
  withProfile(KNOWN_CUSTOMER);
  stripeHolds();
  stripe.createSession.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
  stripe.createCustomer.mockResolvedValue({ id: 'cus_new' });
  stripe.deleteCustomer.mockResolvedValue({ id: 'cus_new', deleted: true });
});

describe('create-checkout: access', () => {
  /* Each call past the first can create a Stripe customer, in an account this
     project does not control. Six a minute is generous for a person changing
     their mind; a loop is not a person. */
  it('refuses a seventh checkout in a minute from one user', async () => {
    for (let i = 0; i < 6; i += 1) {
      const ok = mockResponse();
      await handler(request(), ok);
      expect(ok.statusCode).toBe(200);
    }

    const res = mockResponse();
    await handler(request(), res);

    expect(res.statusCode).toBe(429);
    expect(stripe.createSession).toHaveBeenCalledTimes(6);
  });

  it('refuses anything but POST', async () => {
    const res = mockResponse();
    await handler(mockRequest({ method: 'GET' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('answers 401 when the caller is not authenticated', async () => {
    authenticate.mockRejectedValue(new FakeAuthError('Invalid or expired token'));
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
    stripeHolds({ id: 'sub_live', status: 'active' });
    const res = mockResponse();
    await handler(request(), res);

    expect(res.statusCode).toBe(409);
    expect(stripe.createSession).not.toHaveBeenCalled();
  });

  /* Only `active` used to count. A trial goes on to charge, and a past_due
     subscription is still being collected: the card is fixed in the portal,
     where the client takes a 409, not by buying a second subscription. */
  it.each(['trialing', 'past_due'])('refuses with 409 when one is %s', async (status) => {
    stripeHolds({ id: 'sub_live', status });
    const res = mockResponse();
    await handler(request(), res);

    expect(res.statusCode).toBe(409);
    expect(stripe.createSession).not.toHaveBeenCalled();
  });

  /* A declined first payment, and everything the webhook takes for ended. */
  it.each(['incomplete', 'incomplete_expired', 'unpaid', 'paused'])(
    'starts a checkout beside one that is %s',
    async (status) => {
      stripeHolds({ id: 'sub_old', status });
      const res = mockResponse();
      await handler(request(), res);

      expect(res.statusCode).toBe(200);
      expect(stripe.createSession).toHaveBeenCalled();
    }
  );

  it('asks Stripe about every subscription of the caller that is not cancelled', async () => {
    await handler(request(), mockResponse());
    expect(stripe.listSubscriptions).toHaveBeenCalledWith({ customer: 'cus_existing', limit: 100 });
  });

  it('checks before creating the session, not after', async () => {
    stripeHolds({ id: 'sub_live', status: 'active' });
    await handler(request(), mockResponse());
    expect(stripe.listSubscriptions).toHaveBeenCalled();
    expect(stripe.createSession).not.toHaveBeenCalled();
  });
});

/* Two checkouts started together each created a customer. The profile kept
   the one stored last, both sessions stayed open, and a payment in the other
   found no profile: the webhook answered 500 for three days, and Pro never
   came. */
describe('create-checkout: one customer per account', () => {
  const NO_CUSTOMER = { stripe_customer_id: null, email: 'new@example.com' };

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates it with a key Stripe answers twice with the same customer', async () => {
    withProfile(NO_CUSTOMER);
    await handler(request(), mockResponse());

    expect(stripe.createCustomer).toHaveBeenCalledWith(
      { email: 'new@example.com', metadata: { supabase_user_id: signedIn } },
      { idempotencyKey: expect.stringMatching(new RegExp(`^customer-${signedIn}-\\d+$`)) }
    );
  });

  /* Stripe answers a key with whatever it answered first, a failure
     included, for a day at least: a key for the account alone would turn one
     failed create into a day of refused checkouts. */
  it('keys it on the account and ten minutes, not on the account alone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const tenMinutes = 10 * 60 * 1000;
    const keyAt = async (time: number) => {
      vi.setSystemTime(time);
      withProfile(NO_CUSTOMER);
      await handler(request(), mockResponse());
      const [, options] = stripe.createCustomer.mock.calls.at(-1) as [
        unknown,
        { idempotencyKey: string },
      ];
      return options.idempotencyKey;
    };

    const start = 2_000_000 * tenMinutes + 1000;
    const first = await keyAt(start);
    expect(await keyAt(start + 5 * 60 * 1000)).toBe(first);
    expect(await keyAt(start + tenMinutes)).not.toBe(first);
  });

  it('stores it only where the profile has none yet', async () => {
    withProfile(NO_CUSTOMER);
    await handler(request(), mockResponse());

    expect(db.calls).toContainEqual({
      table: 'profiles',
      op: 'update',
      args: [{ stripe_customer_id: 'cus_new' }],
    });
    expect(db.calls).toContainEqual({
      table: 'profiles',
      op: 'is',
      args: ['stripe_customer_id', null],
    });
  });

  it('opens the session on the customer another checkout stored first, and deletes its own', async () => {
    withProfile([
      profileRow(NO_CUSTOMER),
      { data: [] }, // the conditional write found a customer already there
      profileRow({ stripe_customer_id: 'cus_winner' }),
    ]);
    const res = mockResponse();
    await handler(request(), res);

    expect(res.statusCode).toBe(200);
    expect(stripe.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_winner' })
    );
    // It holds the account's email, and deleting the account would not find it.
    expect(stripe.deleteCustomer).toHaveBeenCalledWith('cus_new');
  });

  it('does not delete the customer Stripe gave both checkouts', async () => {
    withProfile([
      profileRow(NO_CUSTOMER),
      { data: [] },
      profileRow({ stripe_customer_id: 'cus_new' }),
    ]);
    await handler(request(), mockResponse());

    expect(stripe.deleteCustomer).not.toHaveBeenCalled();
    expect(stripe.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_new' })
    );
  });

  it('still opens the checkout when its own customer cannot be deleted, and says so', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    withProfile([
      profileRow(NO_CUSTOMER),
      { data: [] },
      profileRow({ stripe_customer_id: 'cus_winner' }),
    ]);
    stripe.deleteCustomer.mockRejectedValue(new Error('api.stripe.com unreachable'));
    const res = mockResponse();
    await handler(request(), res);

    expect(res.statusCode).toBe(200);
    expect(report).toHaveBeenCalledWith(expect.any(Error), {
      route: 'stripe/checkout',
      userId: signedIn,
      level: 'warning',
      extra: { customer: 'cus_new' },
    });
  });

  it('does not open a session when the customer cannot be stored', async () => {
    withProfile([profileRow(NO_CUSTOMER), { error: { message: 'connection reset' } }]);
    const res = mockResponse();
    await handler(request(), res);

    expect(res.statusCode).toBe(500);
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
      expect.objectContaining({ metadata: { supabase_user_id: signedIn } }),
      expect.anything()
    );
    expect(stripe.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_new' })
    );
  });

  it('sends the user back to this deployment, not to a fixed host', async () => {
    await handler(request(), mockResponse());

    const [args] = stripe.createSession.mock.calls[0] as [
      { success_url: string; cancel_url: string },
    ];
    expect(args.success_url.startsWith(APP_URL)).toBe(true);
    expect(args.cancel_url.startsWith(APP_URL)).toBe(true);
  });

  /* The address a payment returns to used to carry the id of the Checkout
     session, which nothing read and the app's analytics were told. The two
     collectors that read addresses for themselves are also not started on
     an address with a query string, so the page that says a payment went
     through would have gone uncounted. */
  it('sends the user back to addresses that carry nothing but a path', async () => {
    await handler(request(), mockResponse());

    const [args] = stripe.createSession.mock.calls[0] as [
      { success_url: string; cancel_url: string },
    ];
    for (const address of [args.success_url, args.cancel_url]) {
      const { search, hash } = new URL(address);
      expect(search + hash, address).toBe('');
    }
    expect(args.success_url).not.toContain('CHECKOUT_SESSION_ID');
  });

  it('carries the user id into the session metadata', async () => {
    await handler(request(), mockResponse());
    expect(stripe.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { supabase_user_id: signedIn } })
    );
  });
});

/* A demo account is erased a day after it was made, and nobody can sign in to
   it again: a subscription it bought would renew for no one. */
describe('create-checkout: demo accounts', () => {
  const demo = () =>
    authenticate.mockResolvedValue({ id: signedIn, email: 'demo-1700000000-ab12@example.com' });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('are refused where the key moves real money, before Stripe is asked anything', async () => {
    demo();
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_live_key');
    const res = mockResponse();
    await handler(request(), res);

    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ message: expect.stringContaining('demo account') });
    expect(stripe.createCustomer).not.toHaveBeenCalled();
    expect(stripe.createSession).not.toHaveBeenCalled();
  });

  /* In test mode a checkout costs nothing, and paying with a test card is
     part of what the demo is there to show. */
  it('may pay with a test card where the key is a test key', async () => {
    demo();
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_key');
    const res = mockResponse();
    await handler(request(), res);

    expect(res.statusCode).toBe(200);
    expect(stripe.createSession).toHaveBeenCalled();
  });
});
