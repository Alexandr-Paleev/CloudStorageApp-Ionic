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
 * `features` is what a plan gives, and the app's plans page puts a check
 * beside every line of it. `comingSoon` is what is written and tested and not
 * switched on yet; both pages list it after the features, marked as coming
 * soon. Kept among the features, it got a check that said the opposite.
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
      'Share links you can revoke',
    ],
    comingSoon: [],
  },
  pro: {
    name: 'Pro',
    monthlyPriceCents: 900,
    features: [
      `${formatStorage(TIER_LIMITS.pro.storage_limit)} storage`,
      'Everything in Free',
      'Choose upload provider',
    ],
    comingSoon: ['Dropbox'],
  },
} as const;

export type PlanId = keyof typeof PLANS;

/** US dollars, without cents when there are none: "$0", "$9", "$9.50". */
export function formatMonthlyPrice(cents: number): string {
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}
