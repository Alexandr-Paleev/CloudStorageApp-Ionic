import type { VercelRequest, VercelResponse } from '../../libs/server/src/vercel';
import { supabase } from '../../libs/server/src/auth';
import { getAppUrl } from '../../libs/server/src/app-url';
import {
  DEMO_ADDRESS_PATTERN,
  DEMO_FOLDER_NAME,
  DEMO_LIVE_LIMIT,
  DEMO_RATE_LIMIT,
  DEMO_RATE_WINDOW_MS,
  DEMO_SEED,
  DEMO_SWEEP_LIMIT,
  DEMO_SWEEP_PAGE_SIZE,
  DEMO_SWEEP_PAGES,
  demoEmail,
  demoPassword,
  demoStoragePath,
  givesUpItsPlace,
  isExpiredDemoUser,
} from '../../libs/server/src/demo';
import { RateLimiter, clientIp, tooManyRequests } from '../../libs/server/src/rate-limit';
import { applyCors } from '../../libs/server/src/cors';
import { eraseAccount } from '../../libs/server/src/account-erase';
import { configuredProviders } from '../../libs/server/src/erase-providers';
import { report } from '../../libs/server/src/report';

/**
 * POST /api/demo/session — hands an anonymous visitor a signed-in account.
 *
 * The login wall was the single most expensive thing on the site: a person with
 * ninety seconds is not going to invent a password to look at a file manager.
 * This creates a real account, seeds it so the dashboard has something to show,
 * signs it in, and returns the session for the browser to adopt.
 *
 * The account is disposable: once it is 24 hours old, the next demo opened
 * sweeps it, and while the demo is full, one an hour old gives its place up
 * (makeRoom). It is a real account in every other respect — same RLS, same
 * quota trigger, same Stripe test-mode checkout — because a demo that takes a
 * different code path stops proving anything. What differs is what a
 * stranger could use it for: the database holds its storage to
 * DEMO_STORAGE_LIMIT whatever its plan, and the number of demo accounts to
 * DEMO_LIVE_LIMIT (migrations/019), it cannot make a share link
 * (api/share.ts), and on a live Stripe key the checkout refuses it: the
 * erase ends a subscription with no refund, and a month would be paid for a
 * day.
 */

const BUCKET = 'files';
const SIGNED_URL_TTL = 3600;

/* Bounded, but not so tight it punishes a shared egress — see DEMO_RATE_LIMIT.
   Each account it lets through is swept by a demo opened a day later. */
const limiter = new RateLimiter(DEMO_RATE_LIMIT, DEMO_RATE_WINDOW_MS);

interface AdminUser {
  id: string;
  email?: string;
  created_at?: string;
}

/**
 * Demo accounts that have aged out, no more than DEMO_SWEEP_LIMIT of them.
 *
 * The admin API hands accounts out a page at a time, newest first, and this
 * used to read the first page only: once two hundred accounts were newer than a
 * demo, it was never looked at again and never went. A page shorter than asked
 * for is the last one. The answer's `nextPage` is not used, because supabase-js
 * reads only the first digit of it: page 12 comes back as page 1.
 *
 * Bounded by DEMO_SWEEP_PAGES, because a visitor is waiting. Newest first means
 * an account expires near the front, so the bound misses one only if two
 * thousand accounts were made in the day it lived.
 */
async function expiredDemoUsers(): Promise<AdminUser[]> {
  const expired: AdminUser[] = [];

  for (let page = 1; page <= DEMO_SWEEP_PAGES && expired.length < DEMO_SWEEP_LIMIT; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: DEMO_SWEEP_PAGE_SIZE,
    });
    if (error || !data) break;

    const users = data.users as AdminUser[];
    expired.push(...users.filter((u) => isExpiredDemoUser(u)));
    if (users.length < DEMO_SWEEP_PAGE_SIZE) break;
  }

  return expired.slice(0, DEMO_SWEEP_LIMIT);
}

/**
 * Removes demo accounts that have aged out.
 *
 * Runs before the new account rather than after the response: work scheduled
 * after res.json() on a serverless function may never execute, so "clean up
 * later" would mean "never". Failures here are swallowed — a visitor should not
 * be turned away because yesterday's rubbish would not go.
 */
async function sweepExpired(): Promise<void> {
  const expired = await expiredDemoUsers();
  const providers = configuredProviders();

  for (const user of expired) {
    /* The same erase an account deletion runs: every provider by prefix, then
       the rows, then the user. This used to remove the first 200 Supabase
       Storage objects and the rows, and nothing else. Images go to Cloudinary
       by default, so everything a demo visitor uploaded stayed there, paid for
       and counted by nobody, once the row that named it was gone. One account
       that will not go must not stop the next. */
    try {
      const { failures } = await eraseAccount(user.id, { supabase, ...providers });
      if (failures.length > 0) {
        console.error(`[demo/session] sweep left ${failures.join(', ')} behind for ${user.id}`);
      }
    } catch (error) {
      console.error(`[demo/session] sweep could not erase ${user.id}:`, error);
      await report(error, { route: 'demo/sweep', userId: user.id, level: 'warning' });
    }
  }
}

/**
 * Whether DEMO_LIVE_LIMIT demo accounts exist, which is when migrations/019
 * refuses another.
 *
 * Asked after a refusal rather than before every account. The database holds
 * the number, under a lock, and a count read here first would let two
 * visitors who arrive together both find the last place. The admin API
 * reports the refusal as a database error like any other, so this is what
 * tells the two apart. A failed read answers no, and the error is reported
 * as one.
 */
async function demoIsFull(): Promise<boolean> {
  const { count, error } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .filter('email', 'match', DEMO_ADDRESS_PATTERN);
  return !error && (count ?? 0) >= DEMO_LIVE_LIMIT;
}

/**
 * Erases the oldest demo account to make room for this visitor, if it is old
 * enough to give its place up (DEMO_EVICT_AFTER_MS). Says whether it did.
 *
 * Read from `profiles`, the rows migrations/019 counts, by the whole demo
 * address, as the sweep reads accounts: nothing but a demo account can be
 * taken. Two visitors who find the demo full together can pick the same
 * one; the second erase fails, is reported, and its visitor is told the demo
 * is full.
 */
async function makeRoom(): Promise<boolean> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, created_at')
    .filter('email', 'match', DEMO_ADDRESS_PATTERN)
    .order('created_at', { ascending: true })
    .limit(1);

  const oldest = (data as { id: string; created_at: string }[] | null)?.[0];
  if (error || !oldest || !givesUpItsPlace(oldest.created_at)) return false;

  try {
    const { failures } = await eraseAccount(oldest.id, { supabase, ...configuredProviders() });
    if (failures.length > 0) {
      console.error(
        `[demo/session] making room left ${failures.join(', ')} behind for ${oldest.id}`
      );
    }
    return true;
  } catch (eraseError) {
    console.error(`[demo/session] could not make room by erasing ${oldest.id}:`, eraseError);
    await report(eraseError, { route: 'demo/session', userId: oldest.id, level: 'warning' });
    return false;
  }
}

/**
 * Copies the seed assets into the new account's own storage.
 *
 * Fetched over HTTP from the deployment's own origin rather than bundled: files
 * that a serverless function reads off disk need Vercel's includeFiles wiring,
 * and these are already static assets a CDN serves.
 *
 * Best-effort per file. An account with two of three files is a working demo;
 * refusing the whole session because one asset 404'd is not.
 */
async function seed(userId: string, appUrl: string): Promise<void> {
  const { data: folder } = await supabase
    .from('folders')
    .insert({ name: DEMO_FOLDER_NAME, user_id: userId, parent_id: null })
    .select('id')
    .single();

  const folderId = (folder as { id: string } | null)?.id ?? null;

  for (const item of DEMO_SEED) {
    try {
      const response = await fetch(`${appUrl}/demo/${item.asset}`);
      if (!response.ok) continue;
      const bytes = Buffer.from(await response.arrayBuffer());

      const path = demoStoragePath(userId, item.name, Date.now());
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: item.type, upsert: false });
      if (uploadError) continue;

      const { data: signed } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path, SIGNED_URL_TTL);
      if (!signed) continue;

      await supabase.from('files').insert({
        name: item.name,
        size: bytes.length,
        type: item.type,
        download_url: signed.signedUrl,
        storage_path: path,
        storage_type: 'supabase_storage',
        folder_id: item.location === 'folder' ? folderId : null,
        user_id: userId,
      });
    } catch {
      /* one asset short of a full demo is still a demo */
    }
  }
}

/**
 * Exchanges the password we just set for a session.
 *
 * Through the public token endpoint with the anon key, exactly as the browser
 * would: the service-role client has no user session to hand out, and minting
 * one any other way would exercise a path the real login never takes.
 */
async function signIn(email: string, password: string): Promise<Record<string, unknown>> {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required');

  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const session = (await response.json()) as Record<string, unknown>;
  if (!session.access_token) {
    throw new Error(`Could not sign the demo account in: ${JSON.stringify(session)}`);
  }
  return session;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  /* Before anything else: a preflight from the native shell carries no
     Authorization header, and everything below expects one. */
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // 404 rather than 403 where the demo is switched off: a deployment without it
  // should look like a deployment that never had the route.
  if (process.env.DEMO_ENABLED !== 'true') {
    return res.status(404).json({ message: 'Not found' });
  }

  const ip = clientIp(req.headers, req.socket?.remoteAddress);
  if (!limiter.allow(ip)) {
    return tooManyRequests(
      res,
      limiter.retryAfterSeconds(ip),
      'Too many demo sessions. Try again later.'
    );
  }

  try {
    await sweepExpired().catch(() => undefined);

    const email = demoEmail();
    const password = demoPassword();

    const create = () => supabase.auth.admin.createUser({ email, password, email_confirm: true });

    let { data: created, error: createError } = await create();

    /* Full, the limit doing its job. The oldest demo account, once it is an
       hour old, makes room, and the account is asked for once more. */
    if ((createError || !created?.user) && (await demoIsFull()) && (await makeRoom())) {
      ({ data: created, error: createError } = await create());
    }

    if (createError || !created?.user) {
      /* Not reported: a full demo is the limit doing its job, and a place
         frees up once an account is an hour old. */
      if (await demoIsFull()) {
        return res.status(503).json({
          message: 'The demo is full right now. Try again later, or create an account.',
        });
      }
      throw new Error(`Could not create the demo account: ${createError?.message}`);
    }

    await seed(created.user.id, getAppUrl(req)).catch(() => undefined);

    const session = await signIn(email, password);

    return res.status(201).json({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[demo/session]', message);
    await report(error, { route: 'demo/session' });
    return res.status(500).json({ message: 'Could not start a demo session' });
  }
}
