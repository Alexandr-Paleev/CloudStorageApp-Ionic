import { test, expect, supabaseReady } from './fixtures';

/**
 * The one path the whole application exists for, and until now the only one no
 * test touched: put a file in, find it, rename it, take it out again.
 *
 * It covers more than the four mutations. Each step asserts against the list
 * the *next* screen renders, so a broken TanStack Query invalidation — a stale
 * dashboard after an upload or a delete — fails here and nowhere else. And
 * because a .txt is not an image and R2 is unconfigured in this environment,
 * ProviderManager routes it to Supabase Storage, which exercises the bucket
 * policies that until migration 006 existed only in the dashboard.
 */
test.describe('A file, end to end', () => {
  test.skip(!supabaseReady, 'needs Supabase credentials in .env');

  test('uploads, lists, renames and deletes', async ({ page }) => {
    const original = `e2e-original-${Date.now()}.txt`;
    const renamed = `e2e-renamed-${Date.now()}.txt`;

    await test.step('upload', async () => {
      await page.goto('/upload');

      // The visible control is a button that clicks a hidden input; the input
      // is what actually takes the file.
      await page.setInputFiles('#file-input', {
        name: original,
        mimeType: 'text/plain',
        buffer: Buffer.from('uploaded by the end-to-end suite'),
      });
      await expect(page.locator('ion-item h2')).toHaveText(original);

      await page.locator('ion-button', { hasText: 'Upload' }).click();

      // A successful upload navigates back by itself. Waiting for the URL keeps
      // the assertion honest: a failed upload leaves us on /upload with a toast.
      await expect(page).toHaveURL(/\/dashboard$/);
    });

    const row = page.locator('.file-list-item', { hasText: original });

    await test.step('it appears in the list', async () => {
      await expect(row).toBeVisible();
      await expect(row.locator('.file-meta-name')).toHaveText(original);
    });

    await test.step('rename', async () => {
      await row.click();
      await expect(page).toHaveURL(/\/file\/[0-9a-f-]+$/);
      await expect(page.locator('ion-title')).toHaveText(original);

      await page.locator('.action-button', { hasText: 'Rename' }).click();

      // ion-input is a wrapper; the value lives on the native input it renders.
      const input = page.locator('ion-modal ion-input input');
      await input.waitFor({ state: 'visible' });
      await input.fill(renamed);
      await page.locator('ion-button', { hasText: 'Save Changes' }).click();

      await expect(page.locator('ion-title')).toHaveText(renamed);
    });

    await test.step('delete', async () => {
      await page.locator('.delete-button').click();

      // Scoped to the modal on purpose: the action button that opens it also
      // reads "Delete", so an unscoped match clicks the trigger a second time
      // and closes the confirmation instead of accepting it.
      await page.locator('ion-modal ion-button', { hasText: /^Delete$/ }).click();

      // Deleting navigates back to the dashboard, and the list must no longer
      // carry the file under either name.
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(page.locator('.file-list-item', { hasText: renamed })).toHaveCount(0);
      await expect(page.locator('.file-list-item', { hasText: original })).toHaveCount(0);
    });
  });
});
