import { test, expect } from '@playwright/test';

test.describe('Login page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('renders the sign-in form', async ({ page }) => {
    await expect(page.locator('.brand-title')).toHaveText('Cloud Storage');
    await expect(page.locator('.brand-subtitle')).toHaveText('Welcome back');

    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();

    await expect(page.locator('ion-button.submit-button')).toContainText('Sign In');
    await expect(page.locator('ion-button.google-sign-in-button')).toContainText(
      'Sign in with Google'
    );
  });

  test('switches between sign-in and registration modes', async ({ page }) => {
    const switchButton = page.locator('ion-button.switch-auth-button');

    await switchButton.click();
    await expect(page.locator('.brand-subtitle')).toHaveText('Create your secure space');
    await expect(page.locator('ion-button.submit-button')).toContainText('Create Account');

    await switchButton.click();
    await expect(page.locator('.brand-subtitle')).toHaveText('Welcome back');
    await expect(page.locator('ion-button.submit-button')).toContainText('Sign In');
  });

  /**
   * The whole page has to be on screen on a laptop.
   *
   * 1440×720 is a MacBook with a bookmarks bar showing — the size this is most
   * often looked at. The card was 799px tall the day the demo entry was added,
   * against 720 of room, and the wordmark went off the top: every element the
   * page is judged on had been added one at a time, and none of them was the
   * one that broke it.
   */
  test('fits a laptop screen without scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 720 });
    await page.goto('/login');
    await expect(page.locator('.demo-entry, .auth-form-card')).not.toHaveCount(0);

    const overflow = await page.evaluate(() => {
      const scroller = document
        .querySelector('ion-content')
        ?.shadowRoot?.querySelector('.inner-scroll');
      const target = (scroller as HTMLElement) ?? document.documentElement;
      return target.scrollHeight - target.clientHeight;
    });

    expect(overflow, 'the login page scrolls vertically on a laptop').toBeLessThanOrEqual(1);
  });

  /* IonInput is a controlled web component — this guards the value round-trip */
  test('keeps typed credentials in the form', async ({ page }) => {
    const email = page.locator('input[type="email"]');
    const password = page.locator('input[type="password"]');

    await email.fill('e2e@example.com');
    await password.fill('super-secret');

    await expect(email).toHaveValue('e2e@example.com');
    await expect(password).toHaveValue('super-secret');
  });
});
