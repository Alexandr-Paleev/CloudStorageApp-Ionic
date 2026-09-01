import { test as base, expect, type Browser, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * A signed-in browser, and the throwaway account behind it.
 *
 * This machinery used to live inside billing-entry.spec.ts, which meant every
 * scenario needing a session had to copy a hundred lines of admin-API calls
 * before it could test anything. Here it costs one import.
 *
 * The account is per test, not per file or per worker. That is what lets the
 * suite run in parallel: two tests never see each other's files because they
 * never share an owner. It costs two admin calls per test, which is cheap next
 * to a browser launch.
 */

function readEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#') || !t.includes('=')) continue;
      const i = t.indexOf('=');
      out[t.slice(0, i).trim()] = t
        .slice(i + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
    }
  } catch {
    /* no .env — fall through to process.env, which is how CI supplies these */
  }
  return out;
}

const fileEnv = readEnv();
const read = (name: string) => process.env[name] || fileEnv[name] || '';

/** Any variable from .env or the environment — CI supplies these through the latter. */
export const env = read;

export const SUPABASE_URL = read('SUPABASE_URL') || read('VITE_SUPABASE_URL');
const SERVICE_KEY = read('SUPABASE_SERVICE_ROLE_KEY');
export const SUPABASE_ANON_KEY = read('VITE_SUPABASE_ANON_KEY');
const ANON_KEY = SUPABASE_ANON_KEY;

/**
 * Specs needing a session start with
 *   test.skip(!supabaseReady, 'needs Supabase credentials in .env');
 * so a fresh clone without secrets reports them as skipped rather than failing.
 */
export const supabaseReady = Boolean(SUPABASE_URL && SERVICE_KEY && ANON_KEY);

/** supabase-js keeps the session under sb-<project-ref>-auth-token */
const storageKey = supabaseReady
  ? `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`
  : 'unused';

const adminHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

async function admin(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: { ...adminHeaders, ...(init.headers as Record<string, string>) },
  });
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  /** For calling /api/* the way the app does */
  accessToken: string;
}

async function createUser(): Promise<{ user: TestUser; session: unknown }> {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = `E2e!${Math.random().toString(36).slice(2, 12)}`;

  const created = await (
    await admin('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email, password, email_confirm: true }),
    })
  ).json();

  if (!created?.id) {
    throw new Error(`could not create a test user: ${JSON.stringify(created)}`);
  }

  const session = await (
    await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
  ).json();

  const accessToken = (session as { access_token?: string }).access_token;
  if (!accessToken) {
    throw new Error(`could not sign the test user in: ${JSON.stringify(session)}`);
  }

  return { user: { id: created.id, email, password, accessToken }, session };
}

/**
 * Deleting the account is not enough.
 *
 * files.user_id and folders.user_id are plain UUID columns with no foreign key
 * to auth.users, so removing the user leaves their rows behind forever — and
 * these tests run against a real project. Everything the account owns goes
 * first, in an order the cascades allow: storage objects, then files (which
 * cascades to shared_links through file_id), then folders. Deleting the user
 * last takes profiles and dropbox_connections with it.
 */
export async function deleteUser(userId: string): Promise<void> {
  const listed = await admin('/storage/v1/object/list/files', {
    method: 'POST',
    body: JSON.stringify({ prefix: `${userId}/`, limit: 200 }),
  });

  if (listed.ok) {
    const objects = (await listed.json()) as { name: string }[];
    if (objects.length > 0) {
      await admin('/storage/v1/object/files', {
        method: 'DELETE',
        body: JSON.stringify({ prefixes: objects.map((o) => `${userId}/${o.name}`) }),
      });
    }
  }

  await admin(`/rest/v1/files?user_id=eq.${userId}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
  await admin(`/rest/v1/folders?user_id=eq.${userId}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });

  // Checked, and retried once after a pause. This call used to be made and
  // forgotten, which is how accounts accumulated in a real project while every
  // run reported success — a cleanup that fails silently is worse than no
  // cleanup, because nothing ever tells you it is not happening.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const deleted = await admin(`/auth/v1/admin/users/${userId}`, { method: 'DELETE' });
    if (deleted.ok) return;

    if (attempt === 2) {
      throw new Error(
        `could not delete ${userId}: ${deleted.status} ${await deleted.text().catch(() => '')}`
      );
    }
    // An immediate retry would only ask the same overloaded thing again.
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

interface Fixtures {
  /** The throwaway account this test owns. Created before, removed after. */
  user: TestUser;
  /**
   * Hands back an account the test caused to be created somewhere else — the
   * demo endpoint mints its own, so no fixture can create it up front.
   *
   * Registering it here rather than deleting it in the test's own `finally` is
   * the whole point. When a test exceeds its timeout Playwright abandons the
   * body where it stands, so a `finally` never runs and the account survives;
   * fixture teardown is given its own budget and runs anyway. That is exactly
   * how this suite leaked accounts into a real project roughly one run in
   * three, and the symptom was never a failing cleanup — it was a timeout that
   * looked like an unrelated flake.
   */
  disposeAccount: (userId: string) => void;
}

export const test = base.extend<Fixtures>({
  // The empty pattern is required, not sloppy: Playwright parses this argument
  // to work out which fixtures this one depends on, and rejects any parameter
  // that is not a destructuring pattern. This fixture depends on none.
  // eslint-disable-next-line no-empty-pattern
  disposeAccount: async ({}, use) => {
    const ids: string[] = [];
    await use((id) => ids.push(id));
    for (const id of ids) await deleteUser(id);
  },

  // auto, so a test written as ({ page }) is signed in too. Without it the
  // session would depend on whether the test happens to destructure `user`,
  // and a spec that forgot to would quietly run as an anonymous visitor and
  // assert against the login page instead of failing usefully.
  user: [
    async ({ page }, use) => {
      const { user, session } = await createUser();

      // Seeding localStorage before any navigation is what makes the app come up
      // already signed in; going through the login form instead would put the
      // auth UI in the path of every unrelated assertion.
      await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
        storageKey,
        JSON.stringify(session),
      ] as const);

      // Both errors are captured rather than thrown where they happen, and the
      // decision about which one to report is made afterwards.
      //
      // A failing test must not leave an account and its files behind, so the
      // deletion has to run either way. But deleteUser now throws rather than
      // failing quietly, and a throw that escapes a finally block replaces
      // whatever the test was actually failing on — the real assertion error
      // would be swapped for "could not delete <uuid>", making every cleanup
      // hiccup look like the bug. ESLint's no-unsafe-finally is about exactly
      // this, so the shape avoids finally altogether.
      let testError: unknown = null;
      try {
        await use(user);
      } catch (error) {
        testError = error;
      }

      let cleanupError: unknown = null;
      try {
        await deleteUser(user.id);
      } catch (error) {
        cleanupError = error;
      }

      if (testError) {
        if (cleanupError) {
          console.error('[fixtures] cleanup after a failing test also failed:', cleanupError);
        }
        throw testError;
      }
      if (cleanupError) throw cleanupError;
    },
    { auto: true },
  ],
});

/**
 * Fills the picker on the upload page and submits, without waiting for the
 * outcome — a rejected upload stays on the page, and that is a case worth
 * testing too.
 *
 * Through the real form rather than the API on purpose: it is the path a user
 * takes, and the one that routes the file through ProviderManager. A .txt is
 * not an image and R2 is unconfigured here, so it lands in Supabase Storage,
 * the one backend whose bucket policies this suite can observe.
 */
export async function submitUpload(page: Page, name: string, folderId?: string): Promise<void> {
  // handleUpload compares the account's usage against its limit before it does
  // anything, and treats either one being absent as "no reason to stop". Both
  // arrive over the network, so pressing the button first would upload files
  // that the quota should have refused — the waiters are registered before the
  // navigation because the responses can otherwise land first.
  //
  // Both now come from profiles: usage is profiles.bytes_used, a counter kept
  // by the trigger in migrations/007, rather than a walk over every row in
  // files. The two requests differ only by what they select.
  const profiles = (url: string) => url.includes('/rest/v1/profiles');
  const profileLoaded = page.waitForResponse(
    (r) => profiles(r.url()) && !r.url().includes('bytes_used')
  );
  const usageLoaded = page.waitForResponse(
    (r) => profiles(r.url()) && r.url().includes('bytes_used')
  );

  await page.goto(folderId ? `/upload/${folderId}` : '/upload');
  await Promise.all([profileLoaded, usageLoaded]);

  await page.setInputFiles('#file-input', {
    name,
    mimeType: 'text/plain',
    buffer: Buffer.from('uploaded by the end-to-end suite'),
  });
  await page.locator('ion-button', { hasText: 'Upload' }).click();
}

/** Submits and waits for the file to land, returning the id the app gave it. */
export async function uploadFile(page: Page, name: string): Promise<string> {
  await submitUpload(page, name);
  await page.waitForURL(/\/dashboard$/);

  await page.locator('.file-list-item', { hasText: name }).click();
  await page.waitForURL(/\/file\/[0-9a-f-]+$/);

  const id = new URL(page.url()).pathname.split('/').pop();
  if (!id) throw new Error(`could not read the file id from ${page.url()}`);
  return id;
}

/**
 * Moves the account's quota. Lives here because it needs the service-role key:
 * profiles has no UPDATE policy at all, deliberately — every column on it is
 * billing state, and RLS cannot grant write access to some columns and not
 * others (see migrations/002).
 */
export async function setStorageLimit(userId: string, bytes: number): Promise<void> {
  const response = await admin(`/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ storage_limit: bytes }),
  });
  if (!response.ok) {
    throw new Error(`could not set the storage limit: ${await response.text()}`);
  }
}

/**
 * A second browser context with no session at all — for testing what a
 * recipient sees. Cookies and localStorage are separate from `page`.
 */
export async function anonymousPage(
  browser: Browser,
  options: Parameters<Browser['newContext']>[0] = {}
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext(options);
  return { page: await context.newPage(), close: () => context.close() };
}

/**
 * A distinct client address for a test that touches a rate-limited route.
 *
 * Without one, every run of the suite and every request made by hand while
 * developing lands in the same bucket — the dev server holds the counter in
 * module scope and outlives them all. This suite locked itself out of
 * /api/demo/session that way, and the symptom was a 30-second timeout on a
 * login page, not a message about a limit.
 */
export function uniqueForwardedFor(): Record<string, string> {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  return { 'x-forwarded-for': `198.51.100.${octet()}` };
}

export { expect };
