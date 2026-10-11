import type { Page } from '@playwright/test';
import { SITE_ORIGIN } from '@cloud-storage/core/origins';
import {
  test,
  expect,
  anonymousPage,
  supabaseReady,
  uploadFile,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
} from './fixtures';

/**
 * What a share link actually hands over.
 *
 * This is the only place the promise in the README can be checked at all: that
 * a recipient holding the token gets the file and nothing about its owner, and
 * that revoking really closes the door. Both live on the seam between an
 * authenticated session and a browser that has never had one, so no unit test
 * reaches them — /api/share answers a caller carrying no credential except the
 * token in the URL.
 *
 * The page a link opens is not in this suite. It is the public site's
 * (decision 0014): another origin, another deployment, and nothing here
 * starts it. But everything that page shows, and the one thing it does, is
 * made of two answers of /api/share: what the link holds, and where the file
 * is. Both are asked here, as that page asks them, of the functions under
 * test. What the page makes of the answers is the site's own smoke test,
 * whose stand-in for these functions is a copy of what is checked below.
 *
 * It is also the regression test for the policy migration 006 removed, which
 * made every file that had ever been shared readable straight from PostgREST,
 * revoked ones included — exactly what the second case here denies.
 */

/** Asked from inside the page, as the app asks: its own fetch, its own origin. */
async function api(
  page: Page,
  accessToken: string,
  path: string,
  init: { method: string; body?: unknown }
) {
  return page.evaluate(
    async ([p, token, method, body]) => {
      const response = await fetch(p as string, {
        method: method as string,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    },
    [path, accessToken, init.method, init.body ?? null] as const
  );
}

/**
 * The two things a recipient's side asks, on the deployment that made the
 * link, with the token and nothing else.
 *
 * The first is what the site's server asks to render the page, and it must
 * not sign anything: the page is rendered for every bot that unfurls the
 * link. The second is what the visitor's browser asks when the button is
 * pressed.
 */
function asks(app: Page, shareUrl: string) {
  const token = new URL(shareUrl).pathname.split('/').pop();
  const functions = new URL(app.url()).origin;

  return {
    whatItHolds: `${functions}/api/share?token=${token}&describe=1`,
    forTheFile: `${functions}/api/share?token=${token}`,
  };
}

test.describe('A share link, from both sides', () => {
  test.skip(!supabaseReady, 'needs Supabase credentials in .env');

  test('the recipient is given the file and nothing about its owner', async ({
    page,
    user,
    browser,
  }) => {
    const name = `e2e-shared-${Date.now()}.txt`;
    const fileId = await uploadFile(page, name);

    const created = await api(page, user.accessToken, '/api/share', {
      method: 'POST',
      body: { fileId, expiresInDays: 1 },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const { url } = created.body as { url: string };

    // A link is opened on the site, so that is where its address is, and not
    // on this server, which is a dev server on a port.
    expect(url.startsWith(`${SITE_ORIGIN}/s/`), url).toBe(true);

    const guest = await anonymousPage(browser);
    try {
      const ask = asks(page, url);

      // What the page is rendered from: the file's name, size and type, and
      // no address for it. The exact set of keys is the point. An address in
      // this answer would be one minted for every bot that unfurls the link.
      const described = await guest.page.request.get(ask.whatItHolds);
      expect(described.status()).toBe(200);
      const description = (await described.json()) as Record<string, unknown>;
      expect(Object.keys(description).sort()).toEqual(['name', 'size', 'type']);
      expect(description.name).toBe(name);

      // The point of the whole page: the owner is not on it. Their address
      // and id are the identifying strings this test can assert the absence
      // of, in everything the page prints.
      expect(JSON.stringify(description)).not.toContain(user.email);
      expect(JSON.stringify(description)).not.toContain(user.id);

      // What the button asks for: the same three, and where the file is.
      const opened = await guest.page.request.get(ask.forTheFile);
      expect(opened.status()).toBe(200);
      const file = (await opened.json()) as Record<string, unknown>;
      expect(Object.keys(file).sort()).toEqual(['downloadUrl', 'name', 'size', 'type']);
      expect(String(file.downloadUrl)).toMatch(/^https?:\/\//);
      expect(JSON.stringify(file)).not.toContain(user.email);
    } finally {
      await guest.close();
    }
  });

  test('a revoked link stops opening', async ({ page, user, browser }) => {
    const name = `e2e-revoked-${Date.now()}.txt`;
    const fileId = await uploadFile(page, name);

    const created = await api(page, user.accessToken, '/api/share', {
      method: 'POST',
      body: { fileId },
    });
    const { url } = created.body as { url: string };

    // The owner may list their own links — the SELECT policy on shared_links
    // scopes rows to created_by — but never the token, which is stored hashed.
    const rows = await page.request.get(
      `${SUPABASE_URL}/rest/v1/shared_links?file_id=eq.${fileId}&select=id`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${user.accessToken}` } }
    );
    const [link] = (await rows.json()) as { id: string }[];
    expect(link, 'the owner should be able to list the link they just created').toBeTruthy();

    const revoked = await api(page, user.accessToken, `/api/share?id=${link!.id}`, {
      method: 'DELETE',
    });
    expect(revoked.status).toBe(200);

    const guest = await anonymousPage(browser);
    try {
      const ask = asks(page, url);

      // Not described: a page made from a revoked link's description would
      // still be showing the file's name. And not opened. The sentence is
      // checked too, because the page prints it as it comes.
      for (const question of [ask.whatItHolds, ask.forTheFile]) {
        const refused = await guest.page.request.get(question);
        expect(refused.status()).toBe(410);

        const answer = (await refused.json()) as Record<string, unknown>;
        expect(answer).toEqual({ message: 'This link has been revoked' });
      }
    } finally {
      await guest.close();
    }
  });
});
