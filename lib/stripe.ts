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
