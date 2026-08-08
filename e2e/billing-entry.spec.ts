import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * Guards the only permanent route into billing.
 *
 * UpgradeBanner is hidden until storage is 80% full, so before the header link
 * existed a user simply could not reach the plans page — the paid tier was
 * unreachable in normal use, and Pro users had no way to the customer portal.
 *
 * Needs a real session, so it provisions a throwaway user through the Supabase
 * admin API and removes it afterwards. Skipped when .env has no credentials.
 */
function readEnv(): Record<string, string> {
  try {
    const out: Record<string, string> = {};
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#') || !t.includes('=')) continue;
      const i = t.indexOf('=');
      out[t.slice(0, i).trim()] = t
        .slice(i + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
    }
    return out;
  } catch {
    return {};
  }
}

const env = readEnv();
const SUPABASE_URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY;
const ready = Boolean(SUPABASE_URL && SERVICE_KEY && ANON_KEY);

/** supabase-js keeps the session under sb-<project-ref>-auth-token */
const storageKey = ready
  ? `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`
  : 'unused';

test.describe('Billing entry point', () => {
  test.skip(!ready, 'needs Supabase credentials in .env');

  let userId = '';
  let session: unknown = null;

  test.beforeAll(async () => {
    const email = `e2e-billing-${Date.now()}@example.com`;
    const password = `E2e!${Math.random().toString(36).slice(2, 12)}`;

    const createdRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    const created = await createdRes.json();
    expect(
      created.id,
      `не удалось создать тестового пользователя: ${JSON.stringify(created)}`
    ).toBeTruthy();
    userId = created.id;

    const sessionRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    session = await sessionRes.json();
    expect((session as { access_token?: string }).access_token).toBeTruthy();
  });

  test.afterAll(async () => {
    if (!userId) return;
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
      storageKey,
      JSON.stringify(session),
    ] as const);
  });

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
