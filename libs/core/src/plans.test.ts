import { describe, expect, it } from 'vitest';
import { PLANS, formatMonthlyPrice } from './plans';
import { TIER_LIMITS } from './tiers';

describe('the plans', () => {
  it('are the tiers the limits are defined for, and no others', () => {
    expect(Object.keys(PLANS).sort()).toEqual(Object.keys(TIER_LIMITS).sort());
  });

  it('promise the storage the limits enforce', () => {
    expect(PLANS.free.features[0]).toBe('500 MB storage');
    expect(PLANS.pro.features[0]).toBe('5 GB storage');
    expect(TIER_LIMITS.free.storage_limit).toBe(500 * 1024 * 1024);
    expect(TIER_LIMITS.pro.storage_limit).toBe(5 * 1024 * 1024 * 1024);
  });

  it('charge nothing for the free one and something for the other', () => {
    expect(PLANS.free.monthlyPriceCents).toBe(0);
    expect(PLANS.pro.monthlyPriceCents).toBeGreaterThan(0);
  });
});

describe('formatMonthlyPrice', () => {
  it('drops the cents when there are none', () => {
    expect(formatMonthlyPrice(0)).toBe('$0');
    expect(formatMonthlyPrice(900)).toBe('$9');
    expect(formatMonthlyPrice(PLANS.pro.monthlyPriceCents)).toBe('$9');
  });

  it('keeps them when there are', () => {
    expect(formatMonthlyPrice(950)).toBe('$9.50');
    expect(formatMonthlyPrice(1999)).toBe('$19.99');
  });
});
