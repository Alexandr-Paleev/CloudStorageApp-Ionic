import { beforeEach, describe, expect, it, vi } from 'vitest';

const { initializeGA4, initHotjar } = vi.hoisted(() => ({
  initializeGA4: vi.fn(),
  initHotjar: vi.fn(),
}));

vi.mock('../hooks/useAnalytics', () => ({ initializeGA4 }));
vi.mock('./hotjar', () => ({ initHotjar }));

import {
  addressIsBare,
  forgetCollectorsWereStarted,
  startCollectorsOnABareAddress,
} from './collectors';

const at = (search: string, hash: string) => ({ search, hash });

beforeEach(() => {
  vi.clearAllMocks();
  forgetCollectorsWereStarted();
});

describe('an address that is a path and nothing else', () => {
  it('has no query string and no fragment', () => {
    expect(addressIsBare(at('', ''))).toBe(true);
  });

  it.each([
    ['a code after the ?', at('?code=abc&state=x', '')],
    ['tokens after the #', at('', '#access_token=aaa&refresh_token=rrr')],
    ['both', at('?next=1', '#access_token=aaa')],
    ['a query string that looks harmless', at('?tab=links', '')],
  ])('is not one with %s', (_what, address) => {
    expect(addressIsBare(address)).toBe(false);
  });
});

/* Google Analytics and Hotjar read the address for themselves the moment
   they run. Until this, they were started at whatever address the app was
   opened at: an OAuth code reached Google as the path of a page view. */
describe('starting Google Analytics and Hotjar', () => {
  it('starts both on an address that is bare', () => {
    startCollectorsOnABareAddress(at('', ''));

    expect(initializeGA4).toHaveBeenCalledTimes(1);
    expect(initHotjar).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an OAuth callback', at('?code=abc&state=x', '')],
    ['a sign-in come back with its tokens', at('', '#access_token=aaa&refresh_token=rrr')],
  ])('starts neither at %s', (_what, address) => {
    startCollectorsOnABareAddress(address);

    expect(initializeGA4).not.toHaveBeenCalled();
    expect(initHotjar).not.toHaveBeenCalled();
  });

  /* The Supabase client validates a sign-in and then empties the fragment.
     The app asks again when it does. */
  it('starts them when the address has become bare, and not before', () => {
    startCollectorsOnABareAddress(at('', '#access_token=aaa'));
    expect(initializeGA4).not.toHaveBeenCalled();

    startCollectorsOnABareAddress(at('', ''));
    expect(initializeGA4).toHaveBeenCalledTimes(1);
    expect(initHotjar).toHaveBeenCalledTimes(1);
  });

  it('starts them once, however often it is asked', () => {
    startCollectorsOnABareAddress(at('', ''));
    startCollectorsOnABareAddress(at('', ''));
    startCollectorsOnABareAddress(at('', ''));

    expect(initializeGA4).toHaveBeenCalledTimes(1);
    expect(initHotjar).toHaveBeenCalledTimes(1);
  });

  /* Once they run they read the address themselves. Nothing here stops
     them: the rule is about when they start. */
  it('does not stop them again when a later address has a query string', () => {
    startCollectorsOnABareAddress(at('', ''));
    startCollectorsOnABareAddress(at('?code=abc', ''));

    expect(initializeGA4).toHaveBeenCalledTimes(1);
  });

  it('reads the window when it is given no address', () => {
    window.history.replaceState(null, '', '/dashboard?code=abc');
    startCollectorsOnABareAddress();
    expect(initializeGA4).not.toHaveBeenCalled();

    window.history.replaceState(null, '', '/dashboard');
    startCollectorsOnABareAddress();
    expect(initializeGA4).toHaveBeenCalledTimes(1);
  });
});
