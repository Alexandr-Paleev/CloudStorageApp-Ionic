import { env } from '../env';

/**
 * The visitor's answer to "may Google Analytics and Hotjar run?".
 *
 * Both set cookies the app does not need in order to work, and in the EU a
 * cookie like that needs a yes before it is set. Until there is one, neither
 * runs: `collectors.ts` asks here before it starts them.
 *
 * The answer is kept in this browser, in local storage, because the question
 * is put before anyone has signed in. It is put again only when the visitor
 * asks for it: from the foot of the sign-in page, or on the Account page.
 */
export type Consent = 'granted' | 'denied';

/* scripts/ask-the-collectors.mjs writes this key to answer for its visits. */
const KEY = 'analytics-consent';

/* What this page was told, for a browser that refuses local storage, as some
   private windows do. The answer then lasts as long as the page. */
let remembered: Consent | null = null;
let askingAgain = false;
const listeners = new Set<() => void>();

const tell = () => listeners.forEach((listener) => listener());

export function readConsent(): Consent | null {
  try {
    const stored = window.localStorage.getItem(KEY);
    if (stored === 'granted' || stored === 'denied') return stored;
  } catch {
    /* Storage is refused: what this page was told stands instead. */
  }
  return remembered;
}

export function writeConsent(consent: Consent): void {
  remembered = consent;
  askingAgain = false;
  try {
    window.localStorage.setItem(KEY, consent);
  } catch {
    /* Kept for this page above. */
  }
  tell();
}

/** Puts the question again, whatever the answer was. */
export function askAgain(): void {
  askingAgain = true;
  tell();
}

/** Whether the banner should be on screen: no answer yet, or asked again. */
export function questionIsOpen(): boolean {
  return askingAgain || readConsent() === null;
}

/** Calls `listener` whenever the answer changes; returns how to stop. */
export function onConsentChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Whether there is anything to ask about. Only a production build starts
 * either collector, and only with an id to start it with. Anywhere else,
 * development and CI among them, nothing would be set, and nothing is asked.
 */
export function collectorsConfigured(): boolean {
  return import.meta.env.PROD && Boolean(env.VITE_GA4_MEASUREMENT_ID || env.VITE_HOTJAR_SITE_ID);
}

/** Puts this module back as it was loaded. For tests. */
export function forgetConsent(): void {
  remembered = null;
  askingAgain = false;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* Nothing was kept there. */
  }
}
