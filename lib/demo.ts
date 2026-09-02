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

/* The limiter these two constants feed, and the address it counts against, now
   live in lib/rate-limit.ts: /api/share and /api/r2/presign-upload needed the
   same thing, and the copy that guarded this endpoint was the only one there
   was. */
