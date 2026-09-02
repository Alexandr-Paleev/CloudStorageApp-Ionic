import { test, expect, supabaseReady } from './fixtures';

/**
 * Several files at once, picked or dropped.
 *
 * The interesting part is not that three files arrive — it is what the queue
 * does around them: it holds every file with its own state, sends them one
 * after another rather than racing them for the same quota, and refuses the
 * same file twice.
 */
test.describe('Uploading several files', () => {
  test.skip(!supabaseReady, 'needs Supabase credentials in .env');

  const stamp = Date.now();
  const names = [
    `e2e-multi-a-${stamp}.txt`,
    `e2e-multi-b-${stamp}.txt`,
    `e2e-multi-c-${stamp}.txt`,
  ];

  test('queues a dropped file and two picked ones, then sends them in order', async ({ page }) => {
    await page.goto('/upload');

    /* The drop path has no input to set: the browser hands the files over on
       the event, so the event is what the test has to produce. The fixed
       modification time is what makes two drops of "the same file" the same
       file. */
    const drop = async (name: string) => {
      const transfer = await page.evaluateHandle((fileName) => {
        const data = new DataTransfer();
        data.items.add(
          new File(['dropped by the suite'], fileName, {
            type: 'text/plain',
            lastModified: 1_700_000_000_000,
          })
        );
        return data;
      }, name);

      await page.dispatchEvent('[data-testid=dropzone]', 'drop', { dataTransfer: transfer });
    };

    await test.step('a file dropped on the zone joins the queue', async () => {
      await drop(names[0]);
      await expect(page.getByTestId('upload-queue')).toContainText(names[0]);
    });

    await test.step('dropping the very same file again does not queue it twice', async () => {
      // Two rows would mean the same bytes uploaded twice, and the quota spent
      // twice for one file. The identity is name, size and modification time —
      // which is why this drops a file built from the same three, rather than
      // re-picking through the input, where the browser mints a fresh
      // modification time on every pick.
      await drop(names[0]);
      await expect(page.locator('.upload-queue-item')).toHaveCount(1);
    });

    await test.step('picking two more adds them without replacing it', async () => {
      await page.setInputFiles(
        '#file-input',
        names.slice(1).map((name) => ({
          name,
          mimeType: 'text/plain',
          buffer: Buffer.from('picked by the suite'),
        }))
      );

      for (const name of names) {
        await expect(page.getByTestId('upload-queue')).toContainText(name);
      }
    });

    await test.step('a file can be taken out before the run starts', async () => {
      await page.getByLabel(`Remove ${names[2]}`).click();
      await expect(page.locator('.upload-queue-item')).toHaveCount(2);
    });

    await test.step('all of them go, and the dashboard has them', async () => {
      await page.locator('ion-button', { hasText: 'Upload 2 files' }).click();

      await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
      await expect(page.locator('.file-list-item', { hasText: names[0] })).toBeVisible();
      await expect(page.locator('.file-list-item', { hasText: names[1] })).toBeVisible();
      // The one removed from the queue never left the browser.
      await expect(page.locator('.file-list-item', { hasText: names[2] })).toHaveCount(0);
    });
  });
});
