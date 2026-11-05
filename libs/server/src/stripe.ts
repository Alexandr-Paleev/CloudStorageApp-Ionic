import type Stripe from 'stripe';

/**
 * Stripe moved current_period_end off the subscription and onto its items in
 * API version 2025-03-31.basil. Reading the old field yields undefined, which
 * turns into an Invalid Date and throws inside toISOString() — silently
 * breaking every upgrade. Fail loudly instead.
 */
export function getPeriodEnd(subscription: Stripe.Subscription): Date {
  const periodEnd = subscription.items.data[0]?.current_period_end;
  if (!periodEnd) {
    throw new Error(`Subscription ${subscription.id} has no current_period_end on its items`);
  }
  return new Date(periodEnd * 1000);
}

/**
 * Whether Stripe answered that the object is not there.
 *
 * For a customer that means deleted, which is what deleting an account does
 * to one. The deletion, asked a second time, and the webhook, for the events
 * the first one set off, both take it as done rather than as a failure.
 */
export function isMissingInStripe(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'resource_missing';
}

/**
 * Whether a key moves real money: a secret or a restricted key of live mode.
 * Test-mode keys start `sk_test_` and `rk_test_`.
 */
export function isLiveKey(key: string | undefined): boolean {
  return /^(sk|rk)_live_/.test(key ?? '');
}

const BILLING = new Set<Stripe.Subscription.Status>(['active', 'trialing', 'past_due']);

/**
 * Whether a subscription charges, or is going to: what makes a second
 * customer of the same account pay twice (api/stripe/webhook.ts). `past_due`
 * counts, because Stripe is still collecting it.
 *
 * Not `unpaid` or `paused`: Stripe attempts no payment for either. Counted
 * here, a profile naming a customer whose subscription went unpaid would stay
 * there, on Free, while the account paid for Pro through another.
 */
export function isBilling(subscription: Pick<Stripe.Subscription, 'status'>): boolean {
  return BILLING.has(subscription.status);
}

/* The four Stripe's "limit customers to one subscription" treats as a
   subscription the customer already has, active, past_due, unpaid and paused
   (docs.stripe.com/payments/checkout/limit-subscriptions, read 2026-11-05),
   and `trialing`, which goes on to charge. */
const HELD = new Set<Stripe.Subscription.Status>([...BILLING, 'unpaid', 'paused']);

/**
 * Whether a subscription stands in the way of another checkout: what
 * create-checkout refuses with the 409 the client takes to the portal, where
 * a failed card is fixed and an unpaid subscription is paid or cancelled.
 *
 * Wider than isBilling. The webhook counts `unpaid` and `paused` as ended and
 * puts the account back on Free, and the plans page offers Free an upgrade.
 * Let through here, that checkout would go to Stripe, whose setting, which
 * the README asks for, holds both and would send the visitor back to the
 * plans page, to the same button, round and round.
 *
 * `incomplete` is not held, here or by Stripe: it is a first payment that
 * never went through, and holding it would turn away someone whose card was
 * declined until Stripe expires it, 23 hours later.
 */
export function holdsASubscription(subscription: Pick<Stripe.Subscription, 'status'>): boolean {
  return HELD.has(subscription.status);
}
