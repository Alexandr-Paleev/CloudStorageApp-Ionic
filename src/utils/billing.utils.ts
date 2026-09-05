import { Capacitor } from '@capacitor/core';
import { env } from '../env';

/**
 * Whether this build may show the user a way to buy the Pro tier.
 *
 * Two conditions, for two different reasons.
 *
 * `VITE_BILLING_ENABLED` is the older one: a deployment without `STRIPE_*` keys
 * must not show a buy button that would answer with a 500.
 *
 * The platform check is the App Store's. Guideline 3.1.1 requires digital
 * content consumed inside an app to be sold through In-App Purchase, and it
 * does not stop at the purchase itself — an app may not show buttons or links
 * steering the user to buy anywhere else either. Pro storage is exactly that
 * kind of content, and this app sells it through Stripe Checkout, so in the
 * native shell every route into billing has to be closed rather than merely
 * redirected: the plans page, the header button that reaches it, and the banner
 * that appears at 80% of quota.
 *
 * What this deliberately does *not* do is disable billing at build time. One
 * `npm run build` produces both the bundle the browser downloads and the bundle
 * Capacitor copies into the app — the same reasoning as `apiUrl()` beside it —
 * so the web app keeps its storefront while the shell has none.
 *
 * The consequence is honest and worth stating: someone who fills 500 MB in the
 * app has no way to buy more from inside it. That is the trade the free tier
 * makes here, and it is preferable to a purchase flow Apple would reject.
 */
export function billingIsOffered(): boolean {
  return env.VITE_BILLING_ENABLED && !Capacitor.isNativePlatform();
}
