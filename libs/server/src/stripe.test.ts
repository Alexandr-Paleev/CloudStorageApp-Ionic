import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import { getPeriodEnd, isLiveKey, isMissingInStripe } from './stripe';

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

describe('isMissingInStripe', () => {
  it('recognises the code Stripe gives an object that is not there', () => {
    expect(isMissingInStripe({ code: 'resource_missing', statusCode: 404 })).toBe(true);
  });

  /* Anything else is a failure, and has to stay one: read as "already gone",
     a timeout would let an account be erased with its subscription running. */
  it.each([
    ['another code', { code: 'rate_limit' }],
    ['an error with no code', new Error('api.stripe.com unreachable')],
    ['nothing at all', null],
  ])('does not take %s for a missing object', (_, error) => {
    expect(isMissingInStripe(error)).toBe(false);
  });
});

describe('isLiveKey', () => {
  it.each(['sk_live_abc', 'rk_live_abc'])('takes %s for a key that moves money', (key) => {
    expect(isLiveKey(key)).toBe(true);
  });

  it.each(['sk_test_abc', 'rk_test_abc', '', undefined])('does not take %j for one', (key) => {
    expect(isLiveKey(key)).toBe(false);
  });
});
