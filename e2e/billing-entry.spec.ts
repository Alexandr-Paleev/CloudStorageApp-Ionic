import { test, expect, env, supabaseReady } from './fixtures';

/**
 * Guards the only permanent route into billing.
 *
 * UpgradeBanner is hidden until storage is 80% full, so before the header link
 * existed a user simply could not reach the plans page — the paid tier was
 * unreachable in normal use, and Pro users had no way to the customer portal.
 *
 * The throwaway account comes from the fixture; billing itself is behind a
 * flag, so the UI under test only exists where that flag is on.
 */
const billingEnabled = env('VITE_BILLING_ENABLED') === 'true';

test.describe('Billing entry point', () => {
  test.skip(
    !supabaseReady || !billingEnabled,
    'needs Supabase credentials and VITE_BILLING_ENABLED=true'
  );

  test('the dashboard header offers a way to the plans page', async ({ page }) => {
    await page.goto('/dashboard');

    const link = page.getByTestId('pricing-link');
    await expect(link).toBeVisible();

    await link.click();

    await expect(page).toHaveURL(/\/pricing$/);
    await expect(page.locator('.pricing-heading')).toContainText('Choose your plan');
  });

  test('a free user is offered the upgrade on the plans page', async ({ page }) => {
    await page.goto('/pricing');

    await expect(page.locator('ion-button.premium-button')).toContainText('Upgrade to Pro');
  });
});
