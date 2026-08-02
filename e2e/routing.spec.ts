import { test, expect } from '@playwright/test';

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

  test('shows the 404 page for an unknown route', async ({ page }) => {
    await page.goto('/definitely-not-a-route');

    await expect(page).toHaveURL(/\/definitely-not-a-route$/);
    await expect(page.locator('ion-title')).toHaveText('Page Not Found');
    await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
    await expect(page.locator('ion-button')).toContainText('Go to Dashboard');
  });
});
