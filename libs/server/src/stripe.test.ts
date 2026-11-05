import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import {
  getPeriodEnd,
  holdsASubscription,
  isBilling,
  isLiveKey,
  isMissingInStripe,
} from './stripe';

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

describe('isBilling', () => {
  /* What makes a second customer of one account a second payment: a
     subscription that charges, or is still being collected. */
  it.each(['active', 'trialing', 'past_due'] as const)('counts %s', (status) => {
    expect(isBilling({ status })).toBe(true);
  });

  /* Stripe attempts no payment for `unpaid` or `paused`. Counted, a profile
     naming such a customer would keep the account on Free while it paid for
     Pro through another. */
  it.each(['incomplete', 'incomplete_expired', 'canceled', 'unpaid', 'paused'] as const)(
    'does not count %s',
    (status) => {
      expect(isBilling({ status })).toBe(false);
    }
  );
});

describe('holdsASubscription', () => {
  /* The four Stripe's one-subscription setting holds, and a trial. A checkout
     beside one of them would be sent back to the plans page by Stripe. */
  it.each(['active', 'trialing', 'past_due', 'unpaid', 'paused'] as const)('holds %s', (status) => {
    expect(holdsASubscription({ status })).toBe(true);
  });

  /* A first payment that never went through, held, would lock out a declined
     card for a day. */
  it.each(['incomplete', 'incomplete_expired', 'canceled'] as const)(
    'does not hold %s',
    (status) => {
      expect(holdsASubscription({ status })).toBe(false);
    }
  );
});
