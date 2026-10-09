import type { Metadata } from 'next';
import { formatStorage } from '@cloud-storage/core/format';
import { PLANS, formatMonthlyPrice, type PlanId } from '@cloud-storage/core/plans';
import { TIER_LIMITS } from '@cloud-storage/core/tiers';
import { APP_ORIGIN, BILLING_IS_A_DEMONSTRATION } from '../../lib/site';
import layout from '../page.module.css';
import styles from './pricing.module.css';

/* Every number on this page is read from where the app reads it. The plans,
   the price and the limits are in libs/core; nothing here is typed in. */
const FREE_STORAGE = formatStorage(TIER_LIMITS.free.storage_limit);
const PRO_STORAGE = formatStorage(TIER_LIMITS.pro.storage_limit);
const PRO_PRICE = formatMonthlyPrice(PLANS.pro.monthlyPriceCents);

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    `Two plans. Free holds ${FREE_STORAGE} and asks for no card. ` +
    `Pro is ${PRO_PRICE} a month for ${PRO_STORAGE} and a say in where each file is stored.`,
  alternates: { canonical: '/pricing' },
};

const ORDER: readonly PlanId[] = ['free', 'pro'];

const ACTIONS: Record<PlanId, string> = {
  free: 'Start with Free',
  pro: 'Open the app to upgrade',
};

export default function PricingPage() {
  return (
    <>
      <section className={layout.hero}>
        <h1>Two plans, and one of them is free.</h1>
        <p className={layout.lead}>
          Both are the same app. Free holds {FREE_STORAGE} and asks for no card. Pro is {PRO_PRICE}{' '}
          a month, holds {PRO_STORAGE}, and lets you choose where each file is stored.
        </p>
      </section>

      <section className={layout.section} aria-labelledby="plans">
        <h2 id="plans" className={styles.visuallyHidden}>
          The plans
        </h2>

        {BILLING_IS_A_DEMONSTRATION && (
          <p className={styles.notice} role="note">
            <strong>Paying is a demonstration here.</strong> Checkout runs in Stripe&rsquo;s test
            mode. A real card is declined, the test card <code>4242 4242 4242 4242</code> goes
            through, and no money changes hands.
          </p>
        )}

        <ul className={styles.plans}>
          {ORDER.map((id) => {
            const plan = PLANS[id];
            return (
              <li key={id} className={styles.plan}>
                <h3>{plan.name}</h3>
                <p className={styles.price}>
                  <span className={styles.amount}>
                    {formatMonthlyPrice(plan.monthlyPriceCents)}
                  </span>
                  <span className={styles.period}> a month</span>
                </p>
                <ul className={styles.features}>
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <a
                  className={id === 'pro' ? layout.primary : layout.secondary}
                  href={`${APP_ORIGIN}/login`}
                >
                  {ACTIONS[id]}
                </a>
              </li>
            );
          })}
        </ul>
      </section>

      <section className={layout.section} aria-labelledby="leaving-pro">
        <h2 id="leaving-pro">If you leave Pro</h2>
        <p className={layout.prose}>
          The limit goes back to {FREE_STORAGE}. Files already stored stay readable. New uploads are
          refused until the account is under the limit again.
        </p>
      </section>
    </>
  );
}
