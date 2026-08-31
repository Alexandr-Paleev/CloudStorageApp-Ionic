import type { Page } from '@playwright/test';
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
 * It is also the regression test for the policy migration 006 removed, which
 * made every file that had ever been shared readable straight from PostgREST,
 * revoked ones included — exactly what the second case here denies.
 */

/**
 * Minting a link from inside the page rather than through page.request.
 *
 * /api/share builds the returned URL from the Origin header (lib/app-url.ts),
 * and browsers send Origin on every POST while Playwright's APIRequestContext
 * does not — through page.request this route answers 500, which is a property
 * of the test harness and not of the app. Running the same fetch the app runs,
 * in the page that would run it, keeps the two in step.
 */
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

test.describe('A share link, from both sides', () => {
  test.skip(!supabaseReady, 'needs Supabase credentials in .env');

  test('the recipient sees the file and nothing about its owner', async ({
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

    const guest = await anonymousPage(browser);
    try {
      await guest.page.goto(url);

      await expect(guest.page.locator('.shared-file__name')).toHaveText(name);
      await expect(guest.page.locator('ion-button', { hasText: 'Download' })).toBeVisible();

      // The point of the whole page: the owner is not on it. Their address and
      // id are the identifying strings this test can assert the absence of.
      await expect(guest.page.locator('body')).not.toContainText(user.email);
      await expect(guest.page.locator('body')).not.toContainText(user.id);
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

    const revoked = await api(page, user.accessToken, `/api/share?id=${link.id}`, {
      method: 'DELETE',
    });
    expect(revoked.status).toBe(200);

    const guest = await anonymousPage(browser);
    try {
      await guest.page.goto(url);

      await expect(guest.page.getByText('Link unavailable')).toBeVisible();
      await expect(guest.page.locator('.shared-file__message')).toContainText('revoked');
      await expect(guest.page.locator('.shared-file__name')).toHaveCount(0);
    } finally {
      await guest.close();
    }
  });
});
