/** The page a password-reset link is finished on: it asks for the new password. */
export const NEW_PASSWORD_PATH = '/new-password';

/**
 * Where a password-reset link that landed on the wrong page belongs, or null.
 *
 * The link asks Supabase to come back to NEW_PASSWORD_PATH. Supabase comes
 * back to its Site URL instead whenever that address is not on the project's
 * list of redirect URLs, and the Site URL is the app's root, which hands over
 * to the dashboard at once. Whether the Supabase client has read the session
 * out of the fragment by then is a race: if it has not, the link is spent and
 * the person is shown the login page; if it has, they are signed in on the
 * dashboard with no new password and no word about one.
 *
 * So `main.tsx` asks this before anything reads the address, and a reset link
 * is moved to the page that finishes it, fragment and all, for the client to
 * read there. A fragment of any other kind, a sign-in's included, stays where
 * it is.
 */
export function misplacedResetLink(pathname: string, hash: string): string | null {
  if (pathname === NEW_PASSWORD_PATH) return null;

  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (params.get('type') !== 'recovery' || !params.get('access_token')) return null;

  return NEW_PASSWORD_PATH + hash;
}
