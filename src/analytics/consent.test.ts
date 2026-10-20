import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../env', () => ({ env: { VITE_GA4_MEASUREMENT_ID: 'G-TEST' } }));

import {
  askAgain,
  collectorsConfigured,
  type Consent,
  forgetConsent,
  onConsentChange,
  onConsentChangeElsewhere,
  QUESTION,
  questionIsOpen,
  questionWasPutAgain,
  readConsent,
  storedAnswer,
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

  it('is kept in this browser, with what it answered and when', () => {
    writeConsent('granted');

    expect(JSON.parse(window.localStorage.getItem('analytics-consent')!)).toEqual({
      answer: 'granted',
      question: QUESTION,
      at: expect.any(Number),
    });
    expect(readConsent()).toBe('granted');
    expect(questionIsOpen()).toBe(false);
  });

  it('is not read into what something else left under its name', () => {
    window.localStorage.setItem('analytics-consent', 'yes please');
    expect(readConsent()).toBeNull();
  });

  /* The form it was first kept in, which says neither when nor to what. */
  it('is not read from a bare word', () => {
    window.localStorage.setItem('analytics-consent', 'granted');
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
    expect(questionWasPutAgain()).toBe(true);

    writeConsent('granted');
    expect(questionIsOpen()).toBe(false);
    expect(questionWasPutAgain()).toBe(false);
  });

  /* Open because nothing holds is not the same as asked for: only the second
     brings the banner at once. */
  it('is not counted as asked for when it was simply never answered', () => {
    expect(questionIsOpen()).toBe(true);
    expect(questionWasPutAgain()).toBe(false);
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

describe('how long an answer holds', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const keep = (value: string) => window.localStorage.setItem('analytics-consent', value);

  /* 24 months: the longest the AEPD's cookie guide (3.2.8) counts as good
     practice. Until then it is not asked again at every visit. */
  it('holds for two years', () => {
    keep(storedAnswer('granted', Date.now() - 729 * DAY));
    expect(readConsent()).toBe('granted');
  });

  it('is asked again after that', () => {
    keep(storedAnswer('granted', Date.now() - 731 * DAY));
    expect(readConsent()).toBeNull();
    expect(questionIsOpen()).toBe(true);
  });

  /* An answer about two tools says nothing about a third (the guide, 3.2.7). */
  it('is asked again once the question has changed', () => {
    keep(JSON.stringify({ answer: 'granted', question: QUESTION - 1, at: Date.now() }));
    expect(readConsent()).toBeNull();
  });

  /* The collectors' probe answers for its visits by writing the key itself,
     from a script that cannot import this module. */
  it('is written by the collectors’ probe in the form it is read in', () => {
    /* From the repository's root, where the tests run: under jsdom a module's
       own address is not a file's. */
    const probe = readFileSync(resolve('scripts/ask-the-collectors.mjs'), 'utf8');
    expect(probe).toContain("const CONSENT_KEY = 'analytics-consent';");
    expect(probe).toContain(`const CONSENT_QUESTION = ${QUESTION};`);
    expect(probe).toContain('JSON.stringify({ answer, question, at: Date.now() })');
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
  const fromAnotherTab = (consent: Consent) =>
    inAnotherTab((storage) => storage.setItem('analytics-consent', storedAnswer(consent)));

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
    window.localStorage.setItem('analytics-consent', storedAnswer('granted'));
    const passed = vi.fn();
    const stop = onConsentChangeElsewhere(passed);

    await inAnotherTab((storage) => storage.clear());

    expect(passed).toHaveBeenCalledWith(null);
    stop();
  });

  it('is not heard for anything else kept there, nor once nobody listens', async () => {
    const passed = vi.fn();
    const stop = onConsentChangeElsewhere(passed);

    await inAnotherTab((storage) => storage.setItem('theme', 'dark'));
    expect(passed).not.toHaveBeenCalled();

    stop();
    await fromAnotherTab('granted');
    expect(passed).not.toHaveBeenCalled();
    window.localStorage.removeItem('theme');
  });
});
