/**
 * The throwaway account behind "Try the demo".
 *
 * A shared demo account was the obvious alternative and the wrong one: the
 * first visitor to delete the seeded files leaves every later visitor looking
 * at an empty dashboard, and nothing stops one from uploading something the
 * next person should not see. An account per visitor costs two admin calls and
 * makes both problems structurally impossible.
 *
 * The parts that can be reasoned about without a network live here, so they can
 * be tested; api/demo/session.ts holds the orchestration.
 */

/** Demo accounts are recognised by this prefix, and deleted by it. */
export const DEMO_EMAIL_PREFIX = 'demo-';

/** How long a demo account survives before the next request sweeps it up. */
export const DEMO_TTL_MS = 24 * 60 * 60 * 1000;

/** Deletions attempted per request. Bounded so one visitor is not billed the
 *  latency of a backlog that built up while nobody was looking. */
export const DEMO_SWEEP_LIMIT = 5;

export const DEMO_FOLDER_NAME = 'Design assets';

/**
 * Demo sessions allowed per address per hour.
 *
 * Five was tight enough to hit the people this feature exists for: an office or
 * a university behind one NAT sends every visitor from a single address, and
 * the sixth person to click would have been told to come back later.
 */
export const DEMO_RATE_LIMIT = 20;
export const DEMO_RATE_WINDOW_MS = 60 * 60 * 1000;

export interface DemoSeedFile {
  /** File under public/demo/, fetched from the deployment's own origin. */
  asset: string;
  /** Name the app shows. */
  name: string;
  type: string;
  /** Root files are what makes the dashboard look populated; the folder exists
   *  to show that folder scoping is real. */
  location: 'root' | 'folder';
}

/**
 * Deliberately not photographs. Generated gradients read as design assets a
 * person might plausibly store, where stock photos read as filler — and the
 * PDF explains what the visitor is looking at, which nothing else can do.
 */
export const DEMO_SEED: DemoSeedFile[] = [
  {
    asset: 'welcome.pdf',
    name: 'Welcome to Cloud Storage.pdf',
    type: 'application/pdf',
    location: 'root',
  },
  { asset: 'gradient-hero.png', name: 'gradient-hero.png', type: 'image/png', location: 'root' },
  { asset: 'mesh-poster.png', name: 'mesh-poster.png', type: 'image/png', location: 'root' },
  { asset: 'logo-mark.png', name: 'logo-mark.png', type: 'image/png', location: 'folder' },
];

/** An address no real person can receive mail at, tagged so the sweep finds it.
 *  The `e2e-` accounts in e2e/fixtures.ts share this domain and are left alone —
 *  the prefix, not the domain, is what marks an account as disposable here. */
export function demoEmail(now: number = Date.now(), random: () => number = Math.random): string {
  const suffix = random().toString(36).slice(2, 8);
  return `${DEMO_EMAIL_PREFIX}${now}-${suffix}@example.com`;
}

/** Never shown to anyone: the visitor is handed a session, not credentials. */
export function demoPassword(random: () => number = Math.random): string {
  return `Demo!${random().toString(36).slice(2, 12)}${random().toString(36).slice(2, 12)}`;
}

export function isDemoEmail(email: string | undefined): boolean {
  return typeof email === 'string' && email.startsWith(DEMO_EMAIL_PREFIX);
}

/** A demo account past its lifetime. Anything not created by this endpoint is
 *  ignored, so a mistake here cannot reach a real user's account. */
export function isExpiredDemoUser(
  user: { email?: string; created_at?: string },
  now: number = Date.now(),
  ttlMs: number = DEMO_TTL_MS
): boolean {
  if (!isDemoEmail(user.email)) return false;
  if (!user.created_at) return false;
  const created = new Date(user.created_at).getTime();
  if (Number.isNaN(created)) return false;
  return now - created > ttlMs;
}

/**
 * Storage keys are "{userId}/{timestamp}_{name}", and the shape is load-bearing
 * twice over: migration 006 grants access by comparing the first path segment
 * to auth.uid(), and supabase-storage.service.ts builds the same string when
 * the app itself uploads. A seeded object written any other way would be
 * invisible to its owner.
 */
export function demoStoragePath(userId: string, name: string, timestamp: number): string {
  return `${userId}/${timestamp}_${name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
}

/**
 * A fixed-window limiter held in module scope.
 *
 * Honest about what this is: Vercel runs several instances and recycles them,
 * so the ceiling is per-instance and resets on a cold start. That is enough to
 * stop a loop from creating accounts faster than the sweep removes them, and it
 * is not a defence against a distributed attempt. A shared counter (Vercel KV,
 * Upstash) is the real answer and is what every other /api route needs too.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

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
}

/**
 * The address a rate limit should count against.
 *
 * Vercel always sets x-forwarded-for, so production takes the first branch.
 * The other two matter where it does not — `npm run dev`, `vercel dev`, a
 * self-hosted deployment behind a proxy that was never configured to forward
 * it. Falling straight through to a single "unknown" bucket there means every
 * visitor shares one budget, which is how this locked out its own test suite
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
