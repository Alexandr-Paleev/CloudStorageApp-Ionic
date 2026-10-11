import { test, expect } from '@playwright/test';
import { SITE_ORIGIN } from '@cloud-storage/core/origins';

const privateRoutes = [
  '/dashboard',
  '/upload',
  '/file/some-file-id',
  '/pricing',
  '/subscription/success',
];

test.describe('Routing for unauthenticated visitors', () => {
  for (const route of privateRoutes) {
    test(`redirects ${route} to /login`, async ({ page }) => {
      await page.goto(route);

      await expect(page).toHaveURL(/\/login$/);
      await expect(page.locator('.brand-title')).toBeVisible();
    });
  }

  test('redirects the root path to /login', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveURL(/\/login$/);
  });

  /* The app opened share links itself until they moved to the site, and a
     link issued then keeps the app's address for as long as it lives. On
     Vercel a redirect answers it before the app is served. Here, as in a
     browser the app's service worker controls, it is the first lines of the
     app that send it on, before anything is rendered.

     The site is another origin, and is answered for here, so that this
     suite does not depend on a deployment it did not build. */
  test('sends a share link at its old address on to the site', async ({ page }) => {
    await page.route(`${SITE_ORIGIN}/**`, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<title>the site</title>' })
    );

    await page.goto('/s/a-link_issued-while-the-app-opened-them');

    await expect(page).toHaveURL(`${SITE_ORIGIN}/s/a-link_issued-while-the-app-opened-them`);
  });

  test('shows the 404 page for an unknown route', async ({ page }) => {
    await page.goto('/definitely-not-a-route');

    await expect(page).toHaveURL(/\/definitely-not-a-route$/);
    await expect(page.locator('ion-title')).toHaveText('Page Not Found');
    await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
    await expect(page.locator('ion-button')).toContainText('Go to Dashboard');
  });
});
