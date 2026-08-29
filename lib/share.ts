import { createHash, randomBytes } from 'node:crypto';

/** Days a link stays valid unless the caller asks for something else. */
export const DEFAULT_SHARE_DAYS = 7;
export const MAX_SHARE_DAYS = 365;

/**
 * A share token: 32 random bytes, URL-safe.
 *
 * Guessing one is not a realistic attack at this length, which matters because
 * the token is the only credential a link carries — whoever holds it gets the
 * file.
 */
export function generateShareToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Only the hash is stored. A leak of shared_links then reveals nothing usable:
 * the plaintext exists solely in the URL its owner copied.
 */
export function hashShareToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Clamps the requested lifetime into something sane. */
export function resolveExpiry(days: unknown, now: Date = new Date()): Date {
  const requested = typeof days === 'number' && Number.isFinite(days) ? Math.floor(days) : NaN;
  const bounded = Number.isNaN(requested)
    ? DEFAULT_SHARE_DAYS
    : Math.min(Math.max(requested, 1), MAX_SHARE_DAYS);
  return new Date(now.getTime() + bounded * 24 * 60 * 60 * 1000);
}

export interface ShareRow {
  expires_at: string | null;
  revoked_at: string | null;
}

/** Why a link is not usable, or null when it is. */
export function shareUnusableReason(
  row: ShareRow,
  now: Date = new Date()
): 'revoked' | 'expired' | null {
  if (row.revoked_at) return 'revoked';
  if (row.expires_at && new Date(row.expires_at).getTime() <= now.getTime()) return 'expired';
  return null;
}

/** The public URL for a token, on whichever deployment issued it. */
export function shareUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, '')}/s/${token}`;
}
