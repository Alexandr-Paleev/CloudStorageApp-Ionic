import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { isNativePlatform, envMock } = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  envMock: { VITE_BILLING_ENABLED: true },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNativePlatform() },
}));

vi.mock('../env', () => ({ env: envMock }));

import { billingIsOffered } from './billing.utils';

describe('billingIsOffered', () => {
  beforeEach(() => {
    isNativePlatform.mockReturnValue(false);
    envMock.VITE_BILLING_ENABLED = true;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('offers billing on the web when Stripe is configured', () => {
    expect(billingIsOffered()).toBe(true);
  });

  /* The older of the two conditions: a deployment with no STRIPE_* keys must
     not show a buy button that would answer with a 500. */
  it('does not offer it on the web without Stripe keys', () => {
    envMock.VITE_BILLING_ENABLED = false;
    expect(billingIsOffered()).toBe(false);
  });

  /* App Store guideline 3.1.1. Pro storage is digital content consumed in the
     app, so it may be sold only through In-App Purchase — and the rule covers
     routes to a purchase, not just the purchase. The native shell shows none. */
  it('never offers it in the native shell, even with Stripe configured', () => {
    isNativePlatform.mockReturnValue(true);
    expect(billingIsOffered()).toBe(false);
  });

  it('still says no in the native shell with Stripe switched off', () => {
    isNativePlatform.mockReturnValue(true);
    envMock.VITE_BILLING_ENABLED = false;
    expect(billingIsOffered()).toBe(false);
  });
});
