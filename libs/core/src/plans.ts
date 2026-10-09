import { formatStorage } from './format';
import { TIER_LIMITS } from './tiers';

/**
 * What each plan is called, what it costs, and what it says it gives.
 *
 * The app shows this to someone deciding whether to upgrade, and the site
 * shows it to someone who has not signed up. Until both read it from here,
 * the price was typed into the app's page as `$9`, sat beside it as 900
 * cents that the page did not use, and the storage each plan promises was
 * written out as text next to the numbers in `tiers.ts` that enforce it.
 *
 * The line about storage is made from the limit, so the sentence and the
 * check cannot say different things.
 *
 * The price is what the page shows. What a card is charged is the price
 * configured in Stripe, under `STRIPE_PRICE_ID_PRO_MONTHLY`, and nothing
 * in this repository can check that the two agree.
 */
export const PLANS = {
  free: {
    name: 'Free',
    monthlyPriceCents: 0,
    features: [
      `${formatStorage(TIER_LIMITS.free.storage_limit)} storage`,
      'Auto provider selection',
      'Google Drive overflow',
      'Basic analytics',
    ],
  },
  pro: {
    name: 'Pro',
    monthlyPriceCents: 900,
    features: [
      `${formatStorage(TIER_LIMITS.pro.storage_limit)} storage`,
      'All providers + Dropbox',
      'Choose upload provider',
      'Priority support',
    ],
  },
} as const;

export type PlanId = keyof typeof PLANS;

/** US dollars, without cents when there are none: "$0", "$9", "$9.50". */
export function formatMonthlyPrice(cents: number): string {
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}
