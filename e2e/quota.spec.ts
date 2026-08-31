import {
  test,
  expect,
  submitUpload,
  setStorageLimit,
  supabaseReady,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  type TestUser,
} from './fixtures';

/**
 * An account that is out of space is refused, and told why.
 *
 * The quota is the one number that decides what the paid tier is for, and
 * nothing exercised it end to end. Lowering the limit on the profile is enough
 * to reach the boundary — pushing hundreds of megabytes through a browser to
 * find the same edge would only make the suite slow.
 *
 * Note what this does and does not prove. A .txt goes to Supabase Storage,
 * which the browser writes to directly, so what the first two tests exercise is
 * the check in ProviderManager.selectProvider — the one that keeps the user
 * from waiting through an upload that cannot be kept. The binding check is the
 * trigger from migrations/007, and the last test here is the one that reaches
 * it: it writes the row the way the browser can, with the user's own token and
 * no client code in the way.
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

/**
 * Two uploads racing for the last free byte.
 *
 * This is the check-then-act the API had on its own: both requests read the
 * same total, both saw room, both were allowed. Doing it through PostgREST
 * with the user's own token is deliberate — it is exactly the reach a browser
 * has, with none of the client's own checks in the way, so what is under test
 * is only what the database will agree to.
 */
test.describe('Two uploads at once', () => {
  test.skip(!supabaseReady, 'needs Supabase credentials in .env');

  function insertFile(user: TestUser, name: string, size: number) {
    return fetch(`${SUPABASE_URL}/rest/v1/files`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${user.accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        name,
        size,
        type: 'text/plain',
        download_url: 'https://example.invalid/raced',
        storage_path: `${user.id}/${name}`,
        storage_type: 'supabase_storage',
        user_id: user.id,
      }),
    });
  }

  test('cannot both fit into the same remaining space', async ({ user }) => {
    // Room for one of them, not for two.
    await setStorageLimit(user.id, 1000);

    const [first, second] = await Promise.all([
      insertFile(user, 'race-a.txt', 600),
      insertFile(user, 'race-b.txt', 600),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses[0]).toBe(201);
    // PT413 from the trigger, which PostgREST answers as 413 — the same status
    // /api/r2/presign-upload and /api/cloudinary/sign refuse with.
    expect(statuses[1]).toBe(413);

    const kept = await fetch(`${SUPABASE_URL}/rest/v1/files?select=name&user_id=eq.${user.id}`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${user.accessToken}` },
    });
    expect(await kept.json()).toHaveLength(1);
  });

  test('the counter still matches the rows after one is refused', async ({ user }) => {
    await setStorageLimit(user.id, 1000);

    await Promise.all([insertFile(user, 'count-a.txt', 600), insertFile(user, 'count-b.txt', 600)]);

    const profile = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?select=bytes_used&id=eq.${user.id}`,
      {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${user.accessToken}` },
      }
    );

    expect(await profile.json()).toEqual([{ bytes_used: 600 }]);
  });
});
