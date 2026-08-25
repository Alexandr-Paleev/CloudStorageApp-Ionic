import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import { getPeriodEnd } from './stripe';

function subscriptionWith(items: { current_period_end: number }[]): Stripe.Subscription {
  return { id: 'sub_test', items: { data: items } } as unknown as Stripe.Subscription;
}

describe('getPeriodEnd', () => {
  it('reads current_period_end from the subscription item', () => {
    const epochSeconds = 1767225600;
    expect(getPeriodEnd(subscriptionWith([{ current_period_end: epochSeconds }]))).toEqual(
      new Date(epochSeconds * 1000)
    );
  });

  /**
   * Regression guard. Stripe removed current_period_end from the subscription
   * object in API 2025-03-31.basil; reading it there yields undefined, which
   * used to become an Invalid Date and blow up in toISOString() — leaving a
   * paying customer on the free tier with only a 500 in the logs.
   */
  it('throws a named error instead of producing an Invalid Date', () => {
    expect(() => getPeriodEnd(subscriptionWith([]))).toThrow(/current_period_end/);
  });
});
