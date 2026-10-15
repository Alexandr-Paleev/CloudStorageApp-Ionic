import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { initializeGA4, initHotjar, waiting } = vi.hoisted(() => ({
  initializeGA4: vi.fn(),
  initHotjar: vi.fn(),
  waiting: [] as (() => void)[],
}));

vi.mock('../hooks/useAnalytics', () => ({ initializeGA4 }));
vi.mock('./hotjar', () => ({ initHotjar }));
vi.mock('../utils/when-loaded', () => ({
  whenLoadedAndIdle: (task: () => void) => waiting.push(task),
}));

import {
  addressIsBare,
  forgetCollectorsWereStarted,
  startCollectorsOnABareAddress,
} from './collectors';

const at = (search: string, hash: string) => ({ search, hash });

/** The page has loaded and the browser is idle: what was waiting runs. */
function settle() {
  while (waiting.length > 0) waiting.shift()!();
}

beforeEach(() => {
  vi.clearAllMocks();
  waiting.length = 0;
  forgetCollectorsWereStarted();
  window.history.replaceState(null, '', '/dashboard');
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
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
    settle();

    expect(initializeGA4).toHaveBeenCalledTimes(1);
    expect(initHotjar).toHaveBeenCalledTimes(1);
  });

  /* The visitor is not waiting for them: they start once the page has loaded
     and the browser is idle, not while the page is still being drawn. */
  it('waits for the page to have loaded and the browser to be idle', () => {
    startCollectorsOnABareAddress(at('', ''));

    expect(initializeGA4).not.toHaveBeenCalled();
    expect(initHotjar).not.toHaveBeenCalled();

    settle();
    expect(initializeGA4).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an OAuth callback', at('?code=abc&state=x', '')],
    ['a sign-in come back with its tokens', at('', '#access_token=aaa&refresh_token=rrr')],
  ])('starts neither at %s', (_what, address) => {
    startCollectorsOnABareAddress(address);
    settle();

    expect(initializeGA4).not.toHaveBeenCalled();
    expect(initHotjar).not.toHaveBeenCalled();
  });

  /* The Supabase client validates a sign-in and then empties the fragment.
     The app asks again when it does. */
  it('starts them when the address has become bare, and not before', () => {
    startCollectorsOnABareAddress(at('', '#access_token=aaa'));
    settle();
    expect(initializeGA4).not.toHaveBeenCalled();

    startCollectorsOnABareAddress(at('', ''));
    settle();
    expect(initializeGA4).toHaveBeenCalledTimes(1);
    expect(initHotjar).toHaveBeenCalledTimes(1);
  });

  /* They read the address when they start, not when they were asked to. An
     address that has a query string again by then is the one they would be
     told, so they wait for the next bare one. */
  it('asks the address again when it is time to start them', () => {
    startCollectorsOnABareAddress(at('', ''));
    window.history.replaceState(null, '', '/dashboard?code=abc');
    settle();
    expect(initializeGA4).not.toHaveBeenCalled();

    window.history.replaceState(null, '', '/dashboard');
    startCollectorsOnABareAddress();
    settle();
    expect(initializeGA4).toHaveBeenCalledTimes(1);
    expect(initHotjar).toHaveBeenCalledTimes(1);
  });

  it('starts them once, however often it is asked', () => {
    startCollectorsOnABareAddress(at('', ''));
    startCollectorsOnABareAddress(at('', ''));
    settle();
    startCollectorsOnABareAddress(at('', ''));
    settle();

    expect(initializeGA4).toHaveBeenCalledTimes(1);
    expect(initHotjar).toHaveBeenCalledTimes(1);
  });

  it('waits once, however often it is asked while waiting', () => {
    startCollectorsOnABareAddress(at('', ''));
    startCollectorsOnABareAddress(at('', ''));

    expect(waiting).toHaveLength(1);
  });

  /* Once they run they read the address themselves. Nothing here stops
     them: the rule is about when they start. */
  it('does not stop them again when a later address has a query string', () => {
    startCollectorsOnABareAddress(at('', ''));
    settle();
    startCollectorsOnABareAddress(at('?code=abc', ''));
    settle();

    expect(initializeGA4).toHaveBeenCalledTimes(1);
  });

  it('reads the window when it is given no address', () => {
    window.history.replaceState(null, '', '/dashboard?code=abc');
    startCollectorsOnABareAddress();
    settle();
    expect(initializeGA4).not.toHaveBeenCalled();

    window.history.replaceState(null, '', '/dashboard');
    startCollectorsOnABareAddress();
    settle();
    expect(initializeGA4).toHaveBeenCalledTimes(1);
  });
});
