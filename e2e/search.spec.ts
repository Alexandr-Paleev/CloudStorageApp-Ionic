import { test, expect, seedFile, seedFolder, supabaseReady } from './fixtures';

/**
 * Finding one file among many.
 *
 * The listing is paginated fifteen at a time, so every claim here is really a
 * claim about the query rather than about the rendered list: a filter applied
 * in the browser would only ever search the page already on screen. The rows
 * are seeded straight into the database — three other specs cover uploading,
 * and this one is about what happens afterwards.
 */
test.describe('Finding a file', () => {
  test.skip(!supabaseReady, 'needs Supabase credentials in .env');

  test('searches every folder, filters by type, and goes back to the folder afterwards', async ({
    page,
    user,
  }) => {
    const folderId = await seedFolder(user.id, 'Invoices');

    await seedFile(user.id, { name: 'invoice-2024.pdf' });
    await seedFile(user.id, { name: 'holiday.jpg', type: 'image/jpeg' });
    await seedFile(user.id, { name: 'invoice-2019.pdf', folderId });

    await page.goto('/dashboard');

    const row = (name: string) => page.locator('.file-list-item', { hasText: name });

    await test.step('the root shows what is in the root', async () => {
      await expect(row('invoice-2024.pdf')).toBeVisible();
      await expect(row('holiday.jpg')).toBeVisible();
      // The third file is a folder away, and the root listing is not a search.
      await expect(row('invoice-2019.pdf')).toHaveCount(0);
    });

    const search = page.getByTestId('file-search').locator('input');

    await test.step('a search reaches into the folders', async () => {
      await search.fill('invoice');

      await expect(row('invoice-2024.pdf')).toBeVisible();
      await expect(row('invoice-2019.pdf')).toBeVisible();
      await expect(row('holiday.jpg')).toHaveCount(0);

      // The scope changed under the user's feet, so the page says so.
      await expect(page.locator('text=/Searching every folder/')).toBeVisible();
    });

    await test.step('clearing it goes back to the folder that was open', async () => {
      await search.fill('');

      await expect(row('holiday.jpg')).toBeVisible();
      await expect(row('invoice-2019.pdf')).toHaveCount(0);
    });

    await test.step('the type filter narrows the same listing', async () => {
      await page.locator('ion-segment-button', { hasText: 'Images' }).click();

      await expect(row('holiday.jpg')).toBeVisible();
      await expect(row('invoice-2024.pdf')).toHaveCount(0);
    });

    await test.step('and a search inside that filter respects both', async () => {
      await search.fill('invoice');

      // Both conditions hold at once: the invoices are not images.
      await expect(page.locator('.file-list-item')).toHaveCount(0);
    });
  });
});
