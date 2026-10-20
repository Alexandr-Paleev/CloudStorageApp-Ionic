import { initializeGA4 } from '../hooks/useAnalytics';
import { whenLoadedAndIdle } from '../utils/when-loaded';
import { onConsentChangeElsewhere, readConsent, writeConsent } from './consent';
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
 *
 * And neither starts before the page has loaded and the browser is idle:
 * the visitor is not waiting for them. Since the address can change in that
 * time, it is asked again at the moment they start.
 *
 * Nor before the visitor has said yes to them. Both set cookies the app does
 * not need, and the question is put by the banner (`ConsentBanner.tsx`);
 * the answer is read at the same two moments as the address.
 */

let state: 'not asked' | 'waiting' | 'started' = 'not asked';

/** A path and nothing else: no query string, and no fragment. */
export function addressIsBare(address: Pick<Location, 'search' | 'hash'>): boolean {
  return address.search === '' && address.hash === '';
}

/**
 * Starts the two collectors, once, if the address allows it, as soon as the
 * page has loaded and the browser is idle.
 *
 * It is asked again whenever the address may have become bare: on every
 * change of route, and when the fragment changes, which is how the Supabase
 * client removes a sign-in's tokens. Asking costs nothing, and once a start
 * is waiting or done it does nothing.
 */
export function startCollectorsOnABareAddress(
  address: Pick<Location, 'search' | 'hash'> = window.location
): void {
  if (state !== 'not asked' || readConsent() !== 'granted' || !addressIsBare(address)) return;

  state = 'waiting';
  whenLoadedAndIdle(() => {
    /* What they will read is the address as it is now. If it has a query
       string or a fragment again, they wait for the next bare one. And the
       yes may have been taken back in the meantime. */
    if (readConsent() !== 'granted' || !addressIsBare(window.location)) {
      state = 'not asked';
      return;
    }
    state = 'started';
    initializeGA4();
    initHotjar();
  });
}

/** The visitor said yes: the two start as soon as the address allows. */
export function allowCollectors(): void {
  writeConsent('granted');
  startCollectorsOnABareAddress();
}

/**
 * The visitor said no, or took a yes back.
 *
 * What the two have set is removed. If they are already running, the page is
 * loaded again as well: neither can be stopped inside a page it runs in, and
 * a page loaded after a no does not start them.
 */
export function refuseCollectors(reload: () => void = () => window.location.reload()): void {
  const running = state === 'started';
  writeConsent('denied');
  removeTheirCookies();
  if (running) reload();
}

/**
 * Follows an answer given in another tab of the app. A yes starts the two
 * here as well, once the address allows. A no stops them the only way they
 * stop, by loading this page again, as in the tab where it was given; their
 * cookies go first, in case this page wrote them again in the meantime.
 */
export function followAnswersFromOtherTabs(
  reload: () => void = () => window.location.reload()
): () => void {
  return onConsentChangeElsewhere((consent) => {
    if (consent === 'granted') {
      startCollectorsOnABareAddress();
    } else if (state === 'started') {
      removeTheirCookies();
      reload();
    }
  });
}

/* Google Analytics names its cookies `_ga` and `_ga_<id>`, and sets them on
   the page's own host with a leading dot (`_ga @ .<host>`, seen in
   production on 2026-10-17). Hotjar's begin with `_hj`. */
const THEIR_COOKIE = /^(?:_ga(?:_.*)?|_hj.*)$/;

/** Expires every cookie of theirs that this page can see. */
export function removeTheirCookies(): void {
  const host = window.location.hostname;
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0]?.trim() ?? '';
    if (!THEIR_COOKIE.test(name)) continue;
    for (const domain of ['', `; domain=${host}`, `; domain=.${host}`]) {
      document.cookie = `${name}=; Max-Age=0; path=/${domain}`;
    }
  }
}

/** Puts this module back as it was loaded. For tests. */
export function forgetCollectorsWereStarted(): void {
  state = 'not asked';
}
