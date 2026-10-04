/**
 * Where an account's objects live, per provider — and whether a stored path is
 * inside that place.
 *
 * One rule for every route that creates a path or checks one: the upload
 * routes, the delete routes, the share route, the indexer and the account
 * erase. It was written out separately in each of them; a layout change now
 * has one place to happen, plus the constraint below.
 *
 * Mirrors `files_storage_path_is_owners` in migrations/013 and
 * `files_storage_path_is_plain` in migrations/014 — a change to the rule here
 * is a change to those too.
 */

/** The providers whose bytes this app pays for and lays out itself. Google
 *  Drive and Dropbox hold files in the user's own account, under their own
 *  ids, so they have no prefix here. */
export type HostedProvider = 'cloudinary' | 'r2' | 'supabase_storage';

const HOSTED: readonly string[] = ['cloudinary', 'r2', 'supabase_storage'];

function isHosted(storageType: string): storageType is HostedProvider {
  return HOSTED.includes(storageType);
}

/**
 * The folder an account's objects live under, trailing slash included.
 *
 * Cloudinary uploads are signed into `users/<id>/` and R2 objects are written
 * under the same prefix. Supabase Storage uses `<id>/` as the first path
 * segment, which is also the segment its own policies match on.
 *
 * The trailing slash is load-bearing: without it `users/<id>` would authorise
 * `users/<id>0/`.
 */
export function ownerPrefix(provider: HostedProvider, userId: string): string {
  return provider === 'supabase_storage' ? `${userId}/` : `users/${userId}/`;
}

/**
 * Whether a URL parser could read the path as naming another object.
 *
 * Every route that acts on a stored path turns it into a URL, and a browser
 * resolves `..` segments, reads `\` as `/`, decodes `%2e` to `.` and drops tabs
 * and newlines before it does that — so `users/<id>/../<other>/x` passes a
 * prefix check and can name `<other>`'s object by the time it is fetched.
 * Whether a given signer and storage would let that through is not something
 * to depend on. No path this app creates contains any of it: the upload routes
 * put a timestamp in front of a sanitised name, and Cloudinary picks its own
 * public ids. `?` and `#` go with them, because a URL ends its path at either.
 */
function rewritable(path: string): boolean {
  for (const char of path) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || '\\%?#'.includes(char)) return true;
  }
  return path.split('/').some((segment) => segment === '.' || segment === '..');
}

/**
 * Whether the path on a row really belongs to the given account.
 *
 * `files` rows are written by the browser under a policy that says only which
 * *rows* an account may write, never what may go in them — `lib/safe-url.ts`
 * says the same thing about `download_url` one column over. So a caller can
 * put another account's object path into their own row and ask a route that
 * holds the service-role key to read it: the indexer, or `/api/share` before it
 * signs a path for a link. Neither Storage's policies nor R2's bucket care what
 * `auth.uid()` was.
 *
 * An unknown provider is refused rather than guessed about. Google Drive and
 * Dropbox never get here: the indexer skips them, and the share route only asks
 * about the two providers it signs for.
 */
export function ownsStoredPath(
  file: { storage_type: string; storage_path: string },
  userId: string
): boolean {
  return (
    isHosted(file.storage_type) &&
    file.storage_path.startsWith(ownerPrefix(file.storage_type, userId)) &&
    !rewritable(file.storage_path)
  );
}
