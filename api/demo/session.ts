import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../../lib/auth';
import { getAppUrl } from '../../lib/app-url';
import {
  DEMO_FOLDER_NAME,
  DEMO_RATE_LIMIT,
  DEMO_RATE_WINDOW_MS,
  DEMO_SEED,
  DEMO_SWEEP_LIMIT,
  demoEmail,
  demoPassword,
  demoStoragePath,
  isExpiredDemoUser,
} from '../../lib/demo';
import { RateLimiter, clientIp, tooManyRequests } from '../../lib/rate-limit';

/**
 * POST /api/demo/session — hands an anonymous visitor a signed-in account.
 *
 * The login wall was the single most expensive thing on the site: a person with
 * ninety seconds is not going to invent a password to look at a file manager.
 * This creates a real account, seeds it so the dashboard has something to show,
 * signs it in, and returns the session for the browser to adopt.
 *
 * The account is disposable and swept after 24 hours. It is a real account in
 * every other respect — same RLS, same quota, same Stripe test-mode checkout —
 * because a demo that takes a different code path stops proving anything.
 */

const BUCKET = 'files';
const SIGNED_URL_TTL = 3600;

/* Bounded, but not so tight it punishes a shared egress — see DEMO_RATE_LIMIT.
   Each account it lets through is swept within a day regardless. */
const limiter = new RateLimiter(DEMO_RATE_LIMIT, DEMO_RATE_WINDOW_MS);

interface AdminUser {
  id: string;
  email?: string;
  created_at?: string;
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
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error || !data) return;

  const expired = (data.users as AdminUser[]).filter((u) => isExpiredDemoUser(u));

  for (const user of expired.slice(0, DEMO_SWEEP_LIMIT)) {
    // Order matters: files.user_id and folders.user_id are plain UUID columns
    // with no foreign key to auth.users, so deleting the account first would
    // strand every row it owns. Same sequence as e2e/fixtures.ts.
    const { data: objects } = await supabase.storage.from(BUCKET).list(user.id, { limit: 200 });
    if (objects && objects.length > 0) {
      await supabase.storage.from(BUCKET).remove(objects.map((o) => `${user.id}/${o.name}`));
    }
    await supabase.from('files').delete().eq('user_id', user.id);
    await supabase.from('folders').delete().eq('user_id', user.id);
    await supabase.auth.admin.deleteUser(user.id);
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

    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createError || !created?.user) {
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
    return res.status(500).json({ message: 'Could not start a demo session' });
  }
}
