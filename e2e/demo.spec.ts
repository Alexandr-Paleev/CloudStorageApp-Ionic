import { test, expect, anonymousPage, env, supabaseReady, uniqueForwardedFor } from './fixtures';

/**
 * The demo entry point, through the browser.
 *
 * api/demo/session.test.ts covers the handler against mocks, which proves the
 * branching and nothing about the wiring: whether the seeded storage path is
 * one the owner can actually read back, whether the session shape is one
 * supabase-js will adopt, whether the rows land where the dashboard looks. All
 * three are exactly the kind of thing a mock will happily get wrong.
 */
test.describe('Try the demo', () => {
  test.skip(!supabaseReady, 'needs Supabase credentials in .env');
  test.skip(env('DEMO_ENABLED') !== 'true', 'needs DEMO_ENABLED=true');

  /* One request here creates an account, uploads four objects and signs in, so
     this is the slowest test in the suite by some way — around ten seconds
     alone, and more with four workers competing. At the default thirty it
     tipped over under load, and a timeout is not a gentle failure: Playwright
     abandons the body, so anything the test still meant to do never happens. */
  test.setTimeout(90_000);

  test('opens a seeded account without anyone signing up', async ({ browser, disposeAccount }) => {
    // The `user` fixture signs every page in automatically, and a signed-in
    // visitor is bounced off /login before they could see the button. The
    // header keeps this out of the rate limiter's bucket for the dev server,
    // which every other caller on this machine shares.
    const { page, close } = await anonymousPage(browser, {
      extraHTTPHeaders: uniqueForwardedFor(),
    });

    try {
      await page.goto('/login');
      await expect(page.getByTestId('demo-login')).toBeVisible();

      await page.getByTestId('demo-login').click();
      await page.waitForURL(/\/dashboard/);

      // Registered the moment it exists, before any assertion can fail: the
      // account is already in the project by now, and teardown is what removes
      // it whatever happens to the rest of this test.
      const demoUserId = await page.evaluate(() => {
        const key = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
        if (!key) return null;
        const session = JSON.parse(localStorage.getItem(key) as string);
        return session?.user?.id ?? null;
      });
      expect(demoUserId).toBeTruthy();
      disposeAccount(demoUserId as string);

      // Seeded through Supabase Storage, so this also proves the object is
      // readable by its owner — the path has to put the user id in the first
      // segment for the policy in migration 006 to allow it.
      await expect(page.locator('.file-list-item')).toHaveCount(3);
      await expect(page.locator('.folder-card')).toHaveCount(1);

      // The meter reads the same rows the list does; a seeded size of zero
      // would still render a list and would still be wrong.
      await expect(page.locator('.storage-stats')).not.toContainText('0 B of');

      // The fourth seeded file is inside the folder, which is why the root
      // listing shows three — folder scoping, proven rather than assumed.
      await page.locator('.folder-card').first().click();
      await page.waitForURL(/\/dashboard\/[0-9a-f-]+$/);
      await expect(page.locator('.file-list-item')).toHaveCount(1);
    } finally {
      await close();
    }
  });
});
