import {
  test,
  expect,
  supabaseReady,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  uploadFile,
} from './fixtures';

/**
 * Both stores require an app that lets a person sign up to let them delete the
 * account from inside it — Apple 5.1.1(v), Google's account deletion policy.
 *
 * Asserted here rather than only in unit tests because the interesting part is
 * not the handler: it is that the rows and the login really are gone from a
 * live project afterwards, and that the columns with no foreign key to
 * auth.users go with them.
 */
test.describe('Deleting an account', () => {
  test.skip(!supabaseReady, 'needs Supabase credentials in .env');

  test('removes the files, the rows and the login', async ({ page, user }) => {
    /* A file, so the erase has something to erase rather than only a row.
       uploadFile leaves the browser on that file's page. */
    await uploadFile(page, `to-be-deleted-${Date.now()}.txt`);

    await page.goto('/dashboard');
    await page.getByTestId('account-link').click();
    await expect(page.getByText(user.email)).toBeVisible();

    /* The native input, not the ion-input host — the same lesson as the login
       spec: Ionic 9 sets props as properties, and the host is not the field. */
    await page.locator('ion-input#delete-confirm input').fill('DELETE');
    await page.locator('ion-button[color="danger"]').click();

    await expect(page).toHaveURL(/\/login$/);

    /* The account is gone, so its own credentials no longer open a session.
       Asked of the auth API rather than the form, because a failed login in the
       UI looks the same as a typo. */
    const signIn = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: user.password }),
    });
    expect(signIn.ok, 'the deleted account should not be able to sign in').toBe(false);
  });
});
