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
 * Whether a subscription charges, or is going to: one a second checkout would
 * duplicate. `past_due` counts, because Stripe is still collecting it, and a
 * card that failed is fixed in the portal rather than by buying again.
 *
 * `incomplete` does not, as it does not in Stripe's own "limit customers to
 * one subscription": it is a first payment that never went through, and
 * counting it would turn away someone whose card was declined until Stripe
 * expires it, 23 hours later. Nor do the statuses the webhook counts as ended
 * (api/stripe/webhook.ts): those accounts are back on Free.
 */
export function isBilling(subscription: Pick<Stripe.Subscription, 'status'>): boolean {
  return BILLING.has(subscription.status);
}
