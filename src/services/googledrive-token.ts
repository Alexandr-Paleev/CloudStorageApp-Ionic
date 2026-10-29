/**
 * The Google Drive token this browser holds, with whose it is and when it ends.
 *
 * Kept apart from the service that asks Google for one, so that signing out —
 * which happens in the shell every page loads — can drop it without bringing
 * Google's client along.
 */

export interface StoredToken {
  token: string;
  /** The account that connected Drive. No other account is handed the token. */
  userId: string;
  /** Milliseconds since the epoch, with the margin already taken off. */
  expiresAt: number;
}

/** Where the token is kept now. */
const STORAGE_KEY = 'gdrive_token';
/** Where it used to be kept: the bare token, with no owner and no end. */
const LEGACY_KEY = 'gdrive_access_token';

/** A token is taken for ended a minute early, so that no request leaves with
 *  seconds to spare and arrives without them. */
const EXPIRY_MARGIN_MS = 60_000;
/** What Google grants when its answer does not say: an hour. */
const DEFAULT_LIFETIME_S = 3600;

/** The record as last written, for a browser that refuses localStorage. */
let remembered: StoredToken | null = null;

function parse(raw: string): StoredToken | null {
  try {
    const value = JSON.parse(raw) as Partial<StoredToken>;
    return typeof value.token === 'string' &&
      typeof value.userId === 'string' &&
      typeof value.expiresAt === 'number'
      ? (value as StoredToken)
      : null;
  } catch {
    return null;
  }
}

export function readToken(): StoredToken | null {
  try {
    /* A token from before it had an owner and an end could be anyone's and
       of any age, so it is not carried over. */
    localStorage.removeItem(LEGACY_KEY);
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? parse(raw) : null;
  } catch {
    return remembered;
  }
}

export function rememberToken(record: StoredToken): void {
  remembered = record;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* memory keeps it for as long as the page is open */
  }
}

export function forgetToken(): void {
  remembered = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* nothing was stored, then */
  }
}

/** When a token Google says lives `expiresIn` seconds is to be taken for ended. */
export function expiryOf(expiresIn: number | string | undefined, now = Date.now()): number {
  const seconds = Number(expiresIn);
  const lifetime = Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_LIFETIME_S;
  return now + lifetime * 1000 - EXPIRY_MARGIN_MS;
}
