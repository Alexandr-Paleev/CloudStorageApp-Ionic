import type { VercelResponse } from '@vercel/node';

/**
 * The ceiling on how often a caller may reach a route.
 *
 * This started life inside lib/demo.ts, guarding the one endpoint that created
 * accounts, with a note saying every other /api route needed the same thing.
 * They did: POST /api/share mints a credential that bypasses authentication
 * entirely, and presign-upload signs a write into the bucket. Neither had
 * anything stopping a caller from asking for them in a loop.
 *
 * Honest about what this is: Vercel runs several instances of a function and
 * recycles them, so a limit held here is per-instance and resets on a cold
 * start. That stops a loop — which is what these routes were open to — and it
 * is not a defence against a distributed attempt. A shared counter (Vercel KV,
 * Upstash) is the real answer, and it is also a dependency plus a network round
 * trip on every request; worth it when there is traffic to justify it, not
 * before.
 */

/**
 * One window for every limit below, and a short one.
 *
 * An hour reads stricter and behaves worse. Addresses are shared — an office or
 * a university sends every visitor from one of them — so an hour-long window
 * turns one impatient caller into an hour of refusals for everybody behind the
 * same NAT. It also outlives the process it is measured in: `npm run dev` stays
 * up across e2e runs, and the demo endpoint locked its own suite out this way
 * once already.
 *
 * A minute is long enough to be useless to a script, which wants thousands of
 * requests, and short enough that a person who trips it waits seconds.
 */
export const RATE_WINDOW_MS = 60_000;

/**
 * Share links created per user per minute.
 *
 * Creating one is a deliberate act — pick a file, pick an expiry, copy the URL.
 * Ten in a minute is not a person, and each one is a credential that works
 * without a login until it expires.
 */
export const SHARE_CREATE_LIMIT = 10;

/**
 * Every method on /api/share, per address.
 *
 * Opening a link is unauthenticated by design, so on that path this is the only
 * limit there is. It sits high because a link handed round an office is meant
 * to be opened by everyone there, and low enough that walking the token space
 * from one address is pointless — which it already was: the token is 256 bits.
 * What this really buys is a bound on database reads per caller.
 */
export const SHARE_IP_LIMIT = 120;

/**
 * Upload URLs signed per user per minute.
 *
 * The quota caps how many bytes an account can store; this caps how fast it can
 * ask. Sixty leaves room for a bulk selection of files uploading in parallel,
 * which the UI does not do yet but is next on the list.
 */
export const PRESIGN_LIMIT = 60;

/**
 * Upload requests per address, counted before the token is checked.
 *
 * The per-user limit cannot see a caller who never presents a valid token, and
 * validating one costs a round trip to Supabase. This is what bounds that cost.
 */
export const PRESIGN_IP_LIMIT = 120;

/**
 * Cloudinary upload authorizations per user per minute.
 *
 * The same number as PRESIGN_LIMIT and for the same reason: signing an upload
 * is one act, whichever provider the file is bound for. Kept as its own
 * constant because the two routes are free to move apart — images go to
 * Cloudinary and most of this account's files are images, so if either limit
 * turns out to be wrong in practice it will be this one.
 */
export const CLOUDINARY_SIGN_LIMIT = 60;

/**
 * Cloudinary deletions per user per minute.
 *
 * Higher than signing, because clearing out a folder is a normal afternoon and
 * bulk selection is a feature away. Not unlimited, though, which is where this
 * differs from revoking a share link: each deletion is a call to Cloudinary's
 * own API, which has a limit of its own, and ownsAsset() can fall back to
 * reading every Cloudinary row the caller owns. A loop here spends someone
 * else's allowance as well as ours.
 */
export const CLOUDINARY_DELETE_LIMIT = 90;

/** Both Cloudinary actions, per address, counted before the token check —
 *  the same guard, and for the same reason, as PRESIGN_IP_LIMIT. */
export const CLOUDINARY_IP_LIMIT = 120;

/**
 * Every limiter built in this process.
 *
 * Only so that tests can put the module back to a known state: limiters are
 * module-scope singletons, so without this the third test in a file inherits
 * whatever the first two spent. Strong references are fine — the instances are
 * singletons that live as long as the process anyway.
 */
const limiters = new Set<RateLimiter>();

/** Clears every limiter's history. Intended for tests, harmless elsewhere. */
export function resetRateLimits(): void {
  for (const limiter of limiters) limiter.reset();
}

/** A sliding window of hit timestamps per key. */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number = RATE_WINDOW_MS
  ) {
    limiters.add(this);
  }

  allow(key: string, now: number = Date.now()): boolean {
    const cutoff = now - this.windowMs;

    // Sweeping every call keeps the map bounded by the number of active keys
    // rather than by every key ever seen.
    for (const [k, times] of this.hits) {
      const live = times.filter((t) => t > cutoff);
      if (live.length === 0) this.hits.delete(k);
      else this.hits.set(k, live);
    }

    const times = this.hits.get(key) ?? [];
    if (times.length >= this.limit) return false;

    times.push(now);
    this.hits.set(key, times);
    return true;
  }

  /**
   * Seconds until this key has room again — the Retry-After a refusal carries.
   *
   * The window slides, so the answer is when the oldest hit still counted falls
   * out of it, not when a fixed bucket rolls over. Never zero: a client reading
   * "retry after 0 seconds" retries immediately and is refused again.
   */
  retryAfterSeconds(key: string, now: number = Date.now()): number {
    const times = this.hits.get(key);
    if (!times || times.length === 0) return 0;
    return Math.max(1, Math.ceil((times[0] + this.windowMs - now) / 1000));
  }

  reset(): void {
    this.hits.clear();
  }
}

/**
 * The refusal itself.
 *
 * With Retry-After, because a 429 that does not say when to come back invites
 * the client to keep asking — the behaviour the limit exists to stop.
 */
export function tooManyRequests(
  res: VercelResponse,
  retryAfterSeconds: number,
  message: string
): VercelResponse {
  res.setHeader('Retry-After', String(retryAfterSeconds));
  return res.status(429).json({ message });
}

/**
 * The address a rate limit should count against.
 *
 * Vercel always sets x-forwarded-for, so production takes the first branch.
 * The other two matter where it does not — `npm run dev`, `vercel dev`, a
 * self-hosted deployment behind a proxy that was never configured to forward
 * it. Falling straight through to a single "unknown" bucket there means every
 * visitor shares one limit, which is how this locked out its own test suite
 * on the fifth run.
 */
export function clientIp(
  headers: Record<string, string | string[] | undefined>,
  socketAddress?: string
): string {
  const first = (value: string | string[] | undefined) => {
    const raw = Array.isArray(value) ? value[0] : value;
    return raw?.split(',')[0]?.trim();
  };

  return (
    first(headers['x-forwarded-for']) || first(headers['x-real-ip']) || socketAddress || 'unknown'
  );
}
