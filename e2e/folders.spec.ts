import { test, expect, submitUpload, supabaseReady } from './fixtures';

/**
 * A folder keeps its files to itself.
 *
 * The scoping is the entire point of the feature, and it is the part that
 * cannot be seen from inside one screen: the file has to be absent from the
 * root listing, which is a different query with a different folder_id. The
 * dashboard asks for folder_id IS NULL at the root and folder_id = :id inside
 * one, so a regression in either direction shows up here.
 */
test.describe('Folders', () => {
  test.skip(!supabaseReady, 'needs Supabase credentials in .env');

  /* Six seconds when it runs alone, over thirty when four workers are busy on
     a hosted runner — measured, not guessed: the flaky retries pass in 6.2s
     while the first attempt times out. The retry loop below can spend twenty
     of the default thirty on its own before this test reaches its first
     assertion, which leaves nothing for the rest of it. The budget is the
     problem here, not the speed. */
  test.describe.configure({ timeout: 90_000 });

  test('a file uploaded into a folder stays out of the root listing', async ({ page }) => {
    const folder = `e2e-folder-${Date.now()}`;
    const inside = `e2e-inside-${Date.now()}.txt`;

    await page.goto('/dashboard');
    await page.locator('ion-button', { hasText: 'New Folder' }).click();

    // Typed, not filled. fill() sets the DOM value — toHaveValue below passes
    // either way — but the value never reaches the alert's own state, so the
    // Create handler reads an empty name and quietly creates nothing.
    //
    // Retried, because typing alone was not enough either: the alert animates
    // in, and keystrokes sent before it settles are dropped on the floor. That
    // showed up only under parallel load, as an empty input after a full round
    // of pressSequentially — so the retry re-types rather than waiting longer
    // on a value that is never going to arrive.
    const name = page.locator('ion-alert input');
    await expect(async () => {
      await name.click();
      await name.press('ControlOrMeta+a');
      await name.pressSequentially(folder);
      await expect(name).toHaveValue(folder, { timeout: 1000 });
    }).toPass({ timeout: 20_000 });

    // Two claims, asserted separately: that the folder was created, and that
    // the list then shows it. Waiting only for the card reports both failures
    // with the same message — "no such element" — which is what made the bug
    // above take so long to find.
    const inserted = page.waitForResponse(
      (r) => r.url().includes('/rest/v1/folders') && r.request().method() === 'POST'
    );
    await page.locator('ion-alert button', { hasText: 'Create' }).click();
    expect((await inserted).status(), 'the folder should have been created').toBe(201);

    const card = page.locator('.folder-card', { hasText: folder });
    await expect(card, 'the dashboard should refresh after creating a folder').toBeVisible();

    await card.click();
    await expect(page).toHaveURL(/\/dashboard\/[0-9a-f-]+$/);
    const folderId = new URL(page.url()).pathname.split('/').pop() as string;

    await submitUpload(page, inside, folderId);

    // Uploading from inside a folder returns to that folder, not to the root.
    await expect(page).toHaveURL(new RegExp(`/dashboard/${folderId}$`));
    await expect(page.locator('.file-list-item', { hasText: inside })).toBeVisible();

    await page.goto('/dashboard');
    await expect(page.locator('.folder-card', { hasText: folder })).toBeVisible();
    await expect(page.locator('.file-list-item', { hasText: inside })).toHaveCount(0);
  });
});
