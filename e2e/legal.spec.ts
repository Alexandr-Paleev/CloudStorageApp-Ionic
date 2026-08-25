import { test, expect } from '@playwright/test';

/**
 * These pages must open without an account: Stripe reviews them before
 * enabling live payments and app stores need a reachable privacy policy,
 * and neither can sign in.
 */
test.describe('Legal documents', () => {
  test('terms open without signing in', async ({ page }) => {
    await page.goto('/terms');

    await expect(page).toHaveURL(/\/terms$/);
    await expect(page.locator('ion-title')).toHaveText('Terms of Service');
    await expect(page.getByTestId('legal-terms')).toContainText('Acceptance of Terms');
  });

  test('privacy policy opens without signing in', async ({ page }) => {
    await page.goto('/privacy');

    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.locator('ion-title')).toHaveText('Privacy Policy');
    await expect(page.getByTestId('legal-privacy')).toContainText('Information We Collect');
  });

  test('the login page links to both', async ({ page }) => {
    await page.goto('/login');

    const links = page.locator('.legal-links a');
    await expect(links).toHaveCount(2);

    await links.first().click();
    await expect(page).toHaveURL(/\/terms$/);
  });
});
