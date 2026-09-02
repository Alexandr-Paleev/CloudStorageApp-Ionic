import { test, expect, seedFile, seedFolder, supabaseReady } from './fixtures';

/**
 * Moving through folders, and managing them from the interface.
 *
 * Three things that the schema always supported and the interface never did:
 * a path deeper than one level, a way back to the folder above rather than to
 * the root, and renaming or deleting a folder without opening the database.
 */
test.describe('Folders, from the inside', () => {
  test.skip(!supabaseReady, 'needs Supabase credentials in .env');

  test('walks a nested path, renames a folder and deletes one with its contents', async ({
    page,
    user,
  }) => {
    const work = await seedFolder(user.id, 'Work');
    const invoices = await seedFolder(user.id, 'Invoices', work);
    await seedFile(user.id, { name: 'deep-invoice.pdf', folderId: invoices });

    await page.goto(`/dashboard/${invoices}`);

    await test.step('the breadcrumb bar shows the whole path', async () => {
      const crumbs = page.locator('.folder-breadcrumbs');
      await expect(crumbs).toContainText('Home');
      await expect(crumbs).toContainText('Work');
      await expect(crumbs).toContainText('Invoices');
      await expect(page.locator('.file-list-item', { hasText: 'deep-invoice.pdf' })).toBeVisible();
    });

    await test.step('back goes one level up, not to the root', async () => {
      // The old arrow went to /dashboard from any depth, which from here is
      // two levels rather than one.
      await page.locator('ion-button[title="Up one folder"]').click();
      await expect(page).toHaveURL(new RegExp(`/dashboard/${work}$`));
      await expect(page.locator('.folder-card', { hasText: 'Invoices' })).toBeVisible();
    });

    await test.step('a crumb goes straight to the root', async () => {
      await page.locator('.folder-breadcrumbs button', { hasText: 'Home' }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(page.locator('.folder-card', { hasText: 'Work' })).toBeVisible();
    });

    await test.step('renaming a folder', async () => {
      await page.getByTestId(`folder-actions-${work}`).click();
      await page.locator('ion-action-sheet button', { hasText: 'Rename' }).click();

      /* Scoped to this dialog by its header: the dashboard now renders three
         alerts, and every one of them with an input puts that input in the
         DOM whether it is showing or not. */
      const input = page.getByLabel('Rename folder').getByPlaceholder('Folder name');
      await input.waitFor({ state: 'visible' });
      await input.click();
      await input.press('ControlOrMeta+a');
      await input.pressSequentially('Archive');
      await page.getByLabel('Rename folder').locator('button', { hasText: 'Save' }).click();

      await expect(page.locator('.folder-card', { hasText: 'Archive' })).toBeVisible();
      await expect(page.locator('.folder-card', { hasText: 'Work' })).toHaveCount(0);
    });

    await test.step('deleting it takes what is inside with it', async () => {
      await page.getByTestId(`folder-actions-${work}`).click();
      await page.locator('ion-action-sheet button', { hasText: 'Delete' }).click();

      // The dialog says what goes, because it is more than what was clicked.
      const dialog = page.getByLabel('Delete folder?');
      await expect(dialog).toContainText('everything inside it');

      await dialog.locator('button', { hasText: 'Delete' }).click();

      /* Deleting a folder is not one request: every file goes out through its
         provider and then its row, one at a time, and the folders follow from
         the deepest up. Six round trips to Supabase here, so the default five
         seconds is a measure of the network rather than of the feature. */
      const removed = { timeout: 20_000 };
      await expect(page.locator('.folder-card', { hasText: 'Archive' })).toHaveCount(0, removed);

      // The file two levels down went with it — search reaches every folder,
      // so this would find it if any of it had survived.
      await page.getByTestId('file-search').locator('input').fill('deep-invoice');
      await expect(page.locator('.file-list-item')).toHaveCount(0, removed);
    });
  });
});
