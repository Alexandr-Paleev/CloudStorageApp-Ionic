import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../env', () => ({ env: { VITE_GA4_MEASUREMENT_ID: 'G-TEST' } }));

import {
  askAgain,
  collectorsConfigured,
  forgetConsent,
  onConsentChange,
  onConsentChangeElsewhere,
  questionIsOpen,
  readConsent,
  writeConsent,
} from './consent';
import { inAnotherTab } from '../test/another-tab';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  forgetConsent();
});

describe('the answer about analytics cookies', () => {
  it('is not there until it is given', () => {
    expect(readConsent()).toBeNull();
    expect(questionIsOpen()).toBe(true);
  });

  it('is kept in this browser', () => {
    writeConsent('granted');

    expect(window.localStorage.getItem('analytics-consent')).toBe('granted');
    expect(readConsent()).toBe('granted');
    expect(questionIsOpen()).toBe(false);
  });

  it('is not read into what something else left under its name', () => {
    window.localStorage.setItem('analytics-consent', 'yes please');
    expect(readConsent()).toBeNull();
  });

  /* Some private windows refuse local storage. The answer then lasts as long
     as the page, which is better than asking at every click. */
  it('lasts the page when the browser refuses to keep it', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('refused');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('refused');
    });

    writeConsent('denied');
    expect(readConsent()).toBe('denied');
  });

  it('can be asked for again, and an answer closes the question', () => {
    writeConsent('denied');
    askAgain();
    expect(questionIsOpen()).toBe(true);

    writeConsent('granted');
    expect(questionIsOpen()).toBe(false);
  });

  it('is told to whoever listens, until they stop', () => {
    const heard = vi.fn();
    const stop = onConsentChange(heard);

    writeConsent('granted');
    askAgain();
    stop();
    writeConsent('denied');

    expect(heard).toHaveBeenCalledTimes(2);
  });
});

describe('whether there is anything to ask', () => {
  it('is yes in a production build with a collector to start', () => {
    vi.stubEnv('PROD', true);
    expect(collectorsConfigured()).toBe(true);
  });

  /* Development and CI start neither, so a banner there would ask about
     nothing, and lie over the buttons the end-to-end suite presses. */
  it('is no outside a production build', () => {
    vi.stubEnv('PROD', false);
    expect(collectorsConfigured()).toBe(false);
  });
});

/* Local storage tells the other tabs of the app, and not the one that wrote. */
describe('an answer given in another tab', () => {
  const fromAnotherTab = (value: string, key = 'analytics-consent') =>
    inAnotherTab((storage) => storage.setItem(key, value));

  it('is passed on, and told to whoever listens here', async () => {
    const passed = vi.fn();
    const told = vi.fn();
    const stopTelling = onConsentChange(told);
    const stop = onConsentChangeElsewhere(passed);

    await fromAnotherTab('denied');

    expect(passed).toHaveBeenCalledWith('denied');
    expect(told).toHaveBeenCalledTimes(1);
    stop();
    stopTelling();
  });

  it('closes a question this tab had put again', async () => {
    writeConsent('granted');
    askAgain();
    const stop = onConsentChangeElsewhere(vi.fn());

    await fromAnotherTab('denied');

    expect(questionIsOpen()).toBe(false);
    stop();
  });

  /* A clear names no key: the answer went with everything else, and a page
     that only read it there has none now. */
  it('is heard when another tab clears all the app kept there', async () => {
    window.localStorage.setItem('analytics-consent', 'granted');
    const passed = vi.fn();
    const stop = onConsentChangeElsewhere(passed);

    await inAnotherTab((storage) => storage.clear());

    expect(passed).toHaveBeenCalledWith(null);
    stop();
  });

  it('is not heard for anything else kept there, nor once nobody listens', async () => {
    const passed = vi.fn();
    const stop = onConsentChangeElsewhere(passed);

    await fromAnotherTab('dark', 'theme');
    expect(passed).not.toHaveBeenCalled();

    stop();
    await fromAnotherTab('granted');
    expect(passed).not.toHaveBeenCalled();
    window.localStorage.removeItem('theme');
  });
});
