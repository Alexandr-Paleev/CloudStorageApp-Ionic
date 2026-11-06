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

import { randomUUID } from 'node:crypto';
import { DEMO_ADDRESS_PATTERN, DEMO_EMAIL_PREFIX, isDemoEmail } from '../../core/src/demo-address';
import { ownerPrefix } from '../../core/src/stored-path';

/* The address is in libs/core, because the app asks it too. */
export { DEMO_ADDRESS_PATTERN, DEMO_EMAIL_PREFIX, isDemoEmail };

/** How long a demo account survives before the next request sweeps it up. */
export const DEMO_TTL_MS = 24 * 60 * 60 * 1000;

/** Deletions attempted per request. Bounded so one visitor is not billed the
 *  latency of a backlog that built up while nobody was looking. */
export const DEMO_SWEEP_LIMIT = 5;

/** How the sweep reads the accounts: this many to a page, and no more than this
 *  many pages, two thousand accounts, because a visitor waits while it reads. */
export const DEMO_SWEEP_PAGE_SIZE = 200;
export const DEMO_SWEEP_PAGES = 10;

export const DEMO_FOLDER_NAME = 'Design assets';

/**
 * What a demo account may store. It had the Free plan's 500 MB, on an account
 * anyone could open without signing up: 500 MB of hosting a day for whoever
 * asked. The seed is about 150 KB, and this leaves room to try the uploader
 * on a photo or two of the size a phone takes.
 *
 * Held by the database rather than set here (migrations/019): the webhook
 * writes the limit of every plan change, and on test keys the plans page
 * gives the card that pays for Pro. A test holds the migration to this
 * number and to `isDemoEmail`.
 */
export const DEMO_STORAGE_LIMIT = 10 * 1024 * 1024;

/**
 * How many demo accounts may exist at once.
 *
 * A limit on each account bounds none of them together. An address may open
 * DEMO_RATE_LIMIT an hour, the counter is one instance's memory, and an
 * account lives DEMO_TTL_MS: with no count, one address would fill the 1 GB
 * of storage the whole project has on Supabase's free plan, real users'
 * files included, in five hours. Twenty at DEMO_STORAGE_LIMIT is 200 MB of
 * quota. The quota counts rows (decision 0004), and bytes a script puts in a
 * bucket with no row it does not count, for these accounts as for any.
 *
 * Held by the database too (migrations/019), counted under a lock, so two
 * visitors who arrive together cannot both take the last place. The route
 * answers that refusal by making room (DEMO_EVICT_AFTER_MS), and with 503
 * when no demo account is old enough to give its place up. The sweep frees a
 * place as an account ages out.
 */
export const DEMO_LIVE_LIMIT = 20;

/**
 * How long a demo account keeps its place while the demo is full.
 *
 * Twenty places that each last a day, and an address may open twenty an
 * hour: one script could take every place at once and hold it for the day,
 * and everyone after it, a recruiter among them, would be told the demo is
 * full. So a visitor who finds it full takes the place of the oldest demo
 * account once that one is an hour old. A demo is mostly over in minutes,
 * and one still in use an hour on is lost only while the demo is full.
 */
export const DEMO_EVICT_AFTER_MS = 60 * 60 * 1000;

/** Whether a demo account made at `createdAt` gives its place up to a visitor
 *  who finds the demo full. An unreadable time keeps it. */
export function givesUpItsPlace(
  createdAt: string,
  now: number = Date.now(),
  after: number = DEMO_EVICT_AFTER_MS
): boolean {
  const created = new Date(createdAt).getTime();
  return !Number.isNaN(created) && now - created > after;
}

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
 *  The `e2e-` accounts in e2e/fixtures.ts share this domain and are left alone:
 *  the whole address, prefix and domain, is what marks an account as
 *  disposable here (`isDemoEmail`). `Math.random` is enough for the suffix:
 *  all it does is keep apart two visitors who arrive in the same millisecond. */
export function demoEmail(now: number = Date.now(), random: () => number = Math.random): string {
  const suffix = random().toString(36).slice(2, 8);
  return `${DEMO_EMAIL_PREFIX}${now}-${suffix}@example.com`;
}

/** Never shown to anyone: the visitor is handed a session, not credentials.
 *  It is still the password of a real account, so it comes from the system's
 *  cryptographic generator. `Math.random` is not one: its values can be worked
 *  out from earlier ones, and the address of the same account shows the
 *  visitor part of one. `Demo!` and the version digit every UUID carries give
 *  it each kind of character a password policy can ask for. */
export function demoPassword(uuid: () => string = randomUUID): string {
  return `Demo!${uuid()}`;
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
  return `${ownerPrefix('supabase_storage', userId)}${timestamp}_${name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
}

/* The limiter these two constants feed, and the address it counts against, now
   live in libs/server/src/rate-limit.ts: /api/share and /api/r2/presign-upload needed the
   same thing, and the copy that guarded this endpoint was the only one there
   was. */
