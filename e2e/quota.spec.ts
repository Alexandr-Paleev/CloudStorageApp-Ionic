import { test, expect, submitUpload, setStorageLimit, supabaseReady } from './fixtures';

/**
 * An account that is out of space is refused, and told why.
 *
 * The quota is the one number that decides what the paid tier is for, and
 * nothing exercised it end to end. Lowering the limit on the profile is enough
 * to reach the boundary — pushing hundreds of megabytes through a browser to
 * find the same edge would only make the suite slow.
 *
 * Note what this does and does not prove. A .txt goes to Supabase Storage,
 * which the browser writes to directly, so the check under test is the one in
 * ProviderManager.selectProvider — client-side and advisory. Only the R2 path
 * refuses server-side, in /api/r2/presign-upload, and R2 is unconfigured here.
 * The README says as much; this test pins the behaviour that actually ships.
 */
test.describe('Storage quota', () => {
  test.skip(!supabaseReady, 'needs Supabase credentials in .env');

  test('refuses an upload that would not fit, and says so', async ({ page, user }) => {
    await setStorageLimit(user.id, 8);

    await submitUpload(page, `e2e-too-big-${Date.now()}.txt`);

    // Over quota the app does not attempt the upload at all: it offers the one
    // way out that does not cost money, since Google Drive storage is the
    // user's own. Staying on /upload is the other half of the assertion — a
    // redirect to the dashboard would mean the file went through.
    await expect(page.locator('ion-alert')).toContainText('Storage Limit Exceeded');
    await expect(page).toHaveURL(/\/upload$/);
  });

  test('lets the same upload through once there is room', async ({ page, user }) => {
    const name = `e2e-fits-${Date.now()}.txt`;

    await setStorageLimit(user.id, 8);
    await submitUpload(page, name);
    await expect(page.locator('ion-alert')).toContainText('Storage Limit Exceeded');

    await setStorageLimit(user.id, 5 * 1024 * 1024);
    await submitUpload(page, name);

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator('.file-list-item', { hasText: name })).toBeVisible();
  });
});
