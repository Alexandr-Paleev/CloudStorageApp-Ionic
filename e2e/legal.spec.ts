import { test, expect } from '@playwright/test';
import { SITE_ORIGIN } from '@cloud-storage/core/origins';

/**
 * The terms and the privacy policy are pages of the site, and the app holds
 * no copy of either. What is left to check here is that the app sends people
 * to them: from the login page, where an account is made, and from the
 * addresses the app itself used to serve them at.
 *
 * They must open without an account. Stripe reviews them before enabling
 * live payments and app stores need a reachable privacy policy, and neither
 * can sign in.
 *
 * The site is another origin. The second and third tests answer for it
 * themselves, so that this suite does not depend on a deployment it did not
 * build. Whether the site serves the pages is the site's smoke test.
 */
const SITE = SITE_ORIGIN;

test.describe('Legal documents', () => {
  test('the login page links to both, on the site', async ({ page }) => {
    await page.goto('/login');

    const links = page.locator('.legal-links a');
    await expect(links).toHaveCount(2);
    await expect(links.nth(0)).toHaveAttribute('href', `${SITE}/terms`);
    await expect(links.nth(1)).toHaveAttribute('href', `${SITE}/privacy`);
  });

  for (const document of ['terms', 'privacy'] as const) {
    test(`/${document} in the app goes on to the site`, async ({ page }) => {
      await page.route(`${SITE}/**`, (route) =>
        route.fulfill({ contentType: 'text/html', body: '<title>the site</title>' })
      );

      await page.goto(`/${document}`);

      await expect(page).toHaveURL(`${SITE}/${document}`);
    });
  }
});
