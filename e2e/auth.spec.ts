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
