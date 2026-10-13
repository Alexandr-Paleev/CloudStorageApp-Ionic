import { initializeGA4 } from '../hooks/useAnalytics';
import { initHotjar } from './hotjar';

/**
 * Google Analytics and Hotjar: when they are started.
 *
 * Both read the address of the page for themselves, as soon as their script
 * runs, and neither can be told to read a different one. And some of this
 * app's addresses are credentials for as long as they stand. A sign-in comes
 * back with its tokens after the `#`. An OAuth callback carries its code
 * after the `?`. Until 4.10.0 a share link was opened here too, and its
 * token was all it took to read the file: every one opened was sent to
 * Google Analytics.
 *
 * So these two are not started while the address has a query string or a
 * fragment. Nothing in the app keeps either: what arrives with one is used
 * and then removed, or the app moves on. They start at the first moment the
 * address is a path and nothing else, and the page views they are sent from
 * here are paths. Decision 0015.
 *
 * Sentry is not here. It is needed at the worst address as much as at any
 * other, so it starts regardless and what it sends is cleaned on the way
 * out: `observability/scrub.ts`.
 */

let started = false;

/** A path and nothing else: no query string, and no fragment. */
export function addressIsBare(address: Pick<Location, 'search' | 'hash'>): boolean {
  return address.search === '' && address.hash === '';
}

/**
 * Starts the two collectors, once, if the address allows it.
 *
 * It is asked again whenever the address may have become bare: on every
 * change of route, and when the fragment changes, which is how the Supabase
 * client removes a sign-in's tokens. Asking costs nothing, and after the
 * first start it does nothing.
 */
export function startCollectorsOnABareAddress(
  address: Pick<Location, 'search' | 'hash'> = window.location
): void {
  if (started || !addressIsBare(address)) return;

  started = true;
  initializeGA4();
  initHotjar();
}

/** Puts this module back as it was loaded. For tests. */
export function forgetCollectorsWereStarted(): void {
  started = false;
}
