import { env } from '../env';

/**
 * The visitor's answer to "may Google Analytics and Hotjar run?".
 *
 * Both set cookies the app does not need in order to work, and in the EU a
 * cookie like that needs a yes before it is set. Until there is one, neither
 * runs: `collectors.ts` asks here before it starts them.
 *
 * The answer is kept in this browser, in local storage, because the question
 * is put before anyone has signed in. It is put again when the visitor asks
 * for it, from the foot of the sign-in page or on the Account page; when the
 * answer is 24 months old; and when the question itself has changed.
 */
export type Consent = 'granted' | 'denied';

/* scripts/ask-the-collectors.mjs writes this key to answer for its visits, in
   the form `storedAnswer` gives, and a test holds the two to each other. */
const KEY = 'analytics-consent';

/**
 * Which question an answer was given to. Raised when the banner asks about
 * another tool, or about these two for another purpose: an answer to the old
 * question is then asked again. The AEPD's cookie guide (3.2.7) wants a new
 * decision whenever the purposes or the third parties change.
 */
export const QUESTION = 1;

/* An answer holds for 24 months, the longest the AEPD's cookie guide (3.2.8)
   counts as good practice, and is asked again after that. */
const HOLDS_FOR_MS = 730 * 24 * 60 * 60 * 1000;

/** What is kept in local storage for an answer given at `at`. */
export function storedAnswer(consent: Consent, at: number = Date.now()): string {
  return JSON.stringify({ answer: consent, question: QUESTION, at });
}

/* The answer a stored value holds, if it is one and it still holds. A bare
   word, the form the answer was first kept in, is none: it says nothing of
   when it was given, or to what. */
function answerIn(value: string | null): Consent | null {
  if (value === null) return null;
  try {
    const { answer, question, at } = JSON.parse(value) as Record<string, unknown>;
    const holds = question === QUESTION && typeof at === 'number' && Date.now() - at < HOLDS_FOR_MS;
    return holds && (answer === 'granted' || answer === 'denied') ? answer : null;
  } catch {
    return null;
  }
}

/* What this page was told, for a browser that refuses local storage, as some
   private windows do. The answer then lasts as long as the page. */
let remembered: Consent | null = null;
let askingAgain = false;
const listeners = new Set<() => void>();

const tell = () => listeners.forEach((listener) => listener());

export function readConsent(): Consent | null {
  try {
    const answer = answerIn(window.localStorage.getItem(KEY));
    if (answer) return answer;
  } catch {
    /* Storage is refused: what this page was told stands instead. */
  }
  return remembered;
}

export function writeConsent(consent: Consent): void {
  remembered = consent;
  askingAgain = false;
  try {
    window.localStorage.setItem(KEY, storedAnswer(consent));
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

/**
 * Whether the visitor asked for the question again, from "Cookie settings",
 * rather than its being open because nothing holds. The banner then comes at
 * once and takes the focus: it was asked for.
 */
export function questionWasPutAgain(): boolean {
  return askingAgain;
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
 * Calls `listener` with the answer as it now stands when another tab of the
 * app gives one. Local storage tells every other document of this origin
 * through a `storage` event, and does not tell the one that wrote. A question
 * this tab had put again is closed: it has been answered.
 */
export function onConsentChangeElsewhere(listener: (consent: Consent | null) => void): () => void {
  const heard = (event: StorageEvent) => {
    /* A null key: the origin's storage was cleared as a whole. */
    if (event.key !== KEY && event.key !== null) return;
    askingAgain = false;
    tell();
    listener(readConsent());
  };
  window.addEventListener('storage', heard);
  return () => window.removeEventListener('storage', heard);
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
