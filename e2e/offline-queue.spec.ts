import { test, expect, seedFile, supabaseReady } from './fixtures';

/**
 * A change made with no network, sent when it comes back.
 *
 * This is the half of "offline-capable" the app was missing: the service
 * worker already served the shell and the last listing from cache, so a
 * visitor on a train could look at their files and do nothing to them —
 * a rename would fail with a network error and the typing was lost.
 *
 * The test drives the real thing: Playwright takes the whole context offline,
 * which is what the browser reports to `navigator.onLine` and what makes fetch
 * reject the way it does on a train.
 */
test.describe('Working offline', () => {
  test.skip(!supabaseReady, 'needs Supabase credentials in .env');

  test('queues a deletion made offline and sends it when the network returns', async ({
    page,
    context,
    user,
  }) => {
    const doomed = `e2e-offline-${Date.now()}.pdf`;
    const kept = `e2e-kept-${Date.now()}.pdf`;

    await seedFile(user.id, { name: doomed });
    await seedFile(user.id, { name: kept });

    await page.goto('/dashboard');
    await expect(page.locator('.file-list-item', { hasText: doomed })).toBeVisible();

    await test.step('the network goes away', async () => {
      await context.setOffline(true);
    });

    await test.step('deleting still does what the button says', async () => {
      await page
        .locator('.file-list-item', { hasText: doomed })
        .locator('ion-button')
        .last()
        .click();
      /* Scoped to the alert that is actually showing. The dashboard keeps five
         of them in the DOM at once — new folder, rename folder, delete folder,
         delete file — and matching by header alone finds a button in one that
         is not on screen, which clicks nothing. */
      await page.locator('ion-alert:visible').locator('button', { hasText: 'Delete' }).click();

      // Gone from the listing, because the queue applied it locally — a
      // refetch is not an option, that is the request that just failed.
      await expect(page.locator('.file-list-item', { hasText: doomed })).toHaveCount(0);
      await expect(page.locator('.file-list-item', { hasText: kept })).toBeVisible();

      // And said out loud, because it has not actually happened yet.
      await expect(page.getByTestId('offline-queue')).toContainText('1 change waiting');
    });

    await test.step('the change outlives the tab that made it', async () => {
      /* Read out of IndexedDB rather than by reloading the page: offline
         emulation cuts the document request too, and the service worker that
         would serve the shell is switched off for the whole suite (see
         serviceWorkers: 'block' in playwright.config.ts). What durability
         means here is that the change is on disk, not in a promise — and that
         is exactly what this reads. */
      const stored = await page.evaluate(
        () =>
          new Promise<string>((resolve) => {
            const request = indexedDB.open('cloud-storage-mutations');
            request.onsuccess = () => {
              const db = request.result;
              if (!db.objectStoreNames.contains('pending')) return resolve('[]');
              const all = db.transaction('pending').objectStore('pending').getAll();
              all.onsuccess = () => resolve(JSON.stringify(all.result));
            };
            request.onerror = () => resolve('[]');
          })
      );

      expect(JSON.parse(stored)).toHaveLength(1);
      expect(stored).toContain('deleteFile');
    });

    await test.step('and is sent when the network returns', async () => {
      await context.setOffline(false);

      // The browser's own online event is what starts the flush.
      await expect(page.getByTestId('offline-queue')).toHaveCount(0, { timeout: 20_000 });
    });

    await test.step('the file is really gone, not only hidden', async () => {
      await page.goto('/dashboard');
      await expect(page.locator('.file-list-item', { hasText: kept })).toBeVisible();
      await expect(page.locator('.file-list-item', { hasText: doomed })).toHaveCount(0);
    });
  });
});
