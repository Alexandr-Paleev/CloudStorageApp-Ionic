import { ownerPrefix } from '../../core/src/stored-path';

/**
 * Whether the address on a row is one its provider serves: the question to
 * ask before a function obeys that address.
 *
 * `files.download_url` is the browser's writing, like the path beside it. RLS
 * decides whose row it is and never what it says, and the constraint on the
 * column (migration 010) asks only that it be http(s). Two routes act on the
 * value. The indexer fetches it. `/api/share` hands it to whoever holds a
 * link, and the public site sends their browser there when its button is
 * pressed.
 *
 * The indexer has asked this since it was written. The share route asked
 * what the constraint asks, and every https address passed: a row of one's
 * own could name a page anywhere, and the site's Download button, under a
 * file's name and size, sent the recipient to it.
 *
 * Two of the five providers are not here. R2 and Supabase Storage keep
 * private objects, and what their rows store is a signature that ran out
 * long ago. Nothing uses it: `sign-owned-path.ts` signs the path again.
 */

/** A stored address, when it is https and on this host. */
function httpsOn(host: string, address: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(address);
  } catch {
    return null;
  }

  /* The host, compared whole. A name looked for anywhere in an address is
     found in its path or its query string just as well. */
  return parsed.protocol === 'https:' && parsed.hostname === host ? parsed : null;
}

/**
 * Whether a stored Cloudinary delivery URL is in this account's folder.
 *
 * Cloudinary is the one provider of ours whose stored URL is used as it is,
 * because it is a permanent delivery link rather than a signature. The
 * folder is the one every upload is signed into, `users/<id>/`, and it is in
 * the address.
 *
 * Which Cloudinary account the address is in is not asked. A folder of that
 * name in another account is the caller's own upload too, and the host is
 * still Cloudinary's.
 *
 * Fails closed on anything unexpected, including a custom delivery domain: a
 * file that stops being indexable, or shareable, is a visible, fixable
 * annoyance, and a server that obeys any address it is given is not.
 */
export function cloudinaryUrlIsOwned(url: string, userId: string): boolean {
  const parsed = httpsOn('res.cloudinary.com', url);
  return parsed !== null && parsed.pathname.includes(`/${ownerPrefix('cloudinary', userId)}`);
}

/**
 * Where the two providers that keep a file in the user's own account say it
 * is: a Dropbox shared link, and Drive's viewer. Each is what that
 * provider's API returned when the file was uploaded. Nothing in either
 * address names an account of ours, so its host is all there is to hold it
 * to.
 */
const HOST_OF = new Map<string, string>([
  ['dropbox', 'www.dropbox.com'],
  ['googledrive', 'drive.google.com'],
]);

/**
 * Whether the address on a row is on the provider the row names.
 *
 * The provider is the row's writing as well. It is read as the row stands
 * when the address is wanted, because an owner can rewrite a row after
 * sharing it. A provider this has not heard of is refused, and so are the
 * two whose stored address is never used.
 */
export function storedUrlIsOnItsProvider(
  file: { storage_type: string; download_url: string },
  ownerId: string
): boolean {
  if (file.storage_type === 'cloudinary') return cloudinaryUrlIsOwned(file.download_url, ownerId);

  const host = HOST_OF.get(file.storage_type);
  return host !== undefined && httpsOn(host, file.download_url) !== null;
}
