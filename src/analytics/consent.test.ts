import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../env', () => ({ env: { VITE_GA4_MEASUREMENT_ID: 'G-TEST' } }));

import {
  askAgain,
  collectorsConfigured,
  forgetConsent,
  onConsentChange,
  questionIsOpen,
  readConsent,
  writeConsent,
} from './consent';

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
