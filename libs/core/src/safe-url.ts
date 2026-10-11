/**
 * Whether a stored URL is safe to put in an `href`.
 *
 * `files.download_url` is written by the client, under an RLS policy that lets
 * an account write anything it likes into its own row — there is no server-side
 * validation between the browser and the column, and `FileMetadataSchema`
 * dropped its `.url()` check to stop it rejecting long signed URLs.
 *
 * That is fine until the row is shared. `/api/share` hands the recipient a
 * `downloadUrl` taken straight from the row for every provider that stores a
 * delivery URL rather than a private object — Cloudinary, Google Drive and
 * Dropbox — and the page a share link opens sends the browser there when its
 * button is pressed. That page is the public site's now, and
 * `apps/web/lib/open-share.ts` asks this again before it goes. Until step 5
 * of decision 0014 it was a page of the app, and the value was the href of
 * its Download button. A `javascript:` value written into one's own row and
 * then shared is script running on that page's origin, in someone else's
 * browser; the CSP does not stop it, because `script-src` carries
 * `'unsafe-inline'` on both origins and that is what governs `javascript:`
 * URLs.
 *
 * So: an allowlist of two schemes, checked where the value crosses from one
 * account to another and again before it is stored. Deliberately narrower than
 * "is this a URL" and much narrower than a denylist of `javascript:` — a
 * denylist has to be right about every scheme a browser will ever navigate,
 * including the ones with whitespace and control characters in the middle that
 * `new URL()` normalises away.
 */

const SAFE_SCHEMES = new Set(['http:', 'https:']);

export function isSafeHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    /* Relative and malformed both land here. Nothing this app stores is
       relative — every provider returns an absolute delivery URL. */
    return false;
  }

  return SAFE_SCHEMES.has(parsed.protocol);
}
