import { randomUUID } from 'node:crypto';
import {
  anonymousPage,
  expect,
  resetLinkFragment,
  signInStatus,
  supabaseReady,
  test,
} from './fixtures';

/**
 * A forgotten password, from the login page to signing in with the new one.
 *
 * No mail is sent. The request the page makes is answered here, and the link
 * comes from the admin API (resetLinkFragment). What is left is everything the
 * app does with the two, in a browser with no session, which is where someone
 * who has forgotten their password is. The `user` fixture signs `page` in, so
 * each test opens a context of its own.
 */
test.describe('A forgotten password', () => {
  test.skip(!supabaseReady, 'needs Supabase credentials in .env');

  test('asks for a link that comes back to the new-password page', async ({
    browser,
    baseURL,
    user,
  }) => {
    const { page, close } = await anonymousPage(browser);
    try {
      const asked: { url: string; body: unknown }[] = [];
      // Answered here: a real request would mail example.com, and spend the
      // project's allowance of mail on it.
      await page.route('**/auth/v1/recover**', async (route) => {
        asked.push({ url: route.request().url(), body: route.request().postDataJSON() });
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      });

      await page.goto('/login');
      await page.locator('input[type="email"]').fill(user.email);
      await page.locator('ion-button.forgot-password-button').click();

      await expect(page).toHaveURL(/\/forgot-password$/);
      await expect(page.locator('input[type="email"]')).toHaveValue(user.email);
      await page.locator('ion-button', { hasText: 'Send link' }).click();

      await expect(page.getByText(/has an account here/)).toContainText(user.email);
      expect(asked).toHaveLength(1);
      expect(new URL(asked[0]!.url).searchParams.get('redirect_to')).toBe(
        `${baseURL}/new-password`
      );
      expect(asked[0]!.body).toMatchObject({ email: user.email });
    } finally {
      await close();
    }
  });

  test('a reset link sets a new password, and only the new one signs in', async ({
    browser,
    user,
  }) => {
    const fragment = await resetLinkFragment(user.email);
    const { page, close } = await anonymousPage(browser);
    try {
      await page.goto(`/new-password${fragment}`);
      // Named only once the link's session has been read: the context had none.
      await expect(page.getByText(user.email)).toBeVisible();

      const chosen = `E2e!${randomUUID()}`;
      const fields = page.locator('input[type="password"]');
      await fields.nth(0).fill(chosen);
      await fields.nth(1).fill(chosen);
      await page.locator('ion-button', { hasText: 'Save password' }).click();

      await expect(page).toHaveURL(/\/dashboard$/);
      expect(await signInStatus(user.email, chosen)).toBe(200);
      expect(await signInStatus(user.email, user.password)).toBe(400);
    } finally {
      await close();
    }
  });

  /* The auth server comes back to its Site URL, the app's root, when the
     address it was asked for is not on its list, and the root hands over to
     the dashboard at once. main.tsx moves the link before that can happen. */
  test('a link that comes back to the root still reaches the new-password page', async ({
    browser,
    user,
  }) => {
    const fragment = await resetLinkFragment(user.email);
    const { page, close } = await anonymousPage(browser);
    try {
      await page.goto(`/${fragment}`);

      await expect(page).toHaveURL(/\/new-password/);
      await expect(page.getByText(user.email)).toBeVisible();
    } finally {
      await close();
    }
  });
});
