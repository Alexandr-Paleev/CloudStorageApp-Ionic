/**
 * A smaller copy of a picture on Cloudinary, asked for in its address.
 *
 * A photo from a phone is 3 to 8 MB, and the free path's model takes 3 MB at
 * most (`maxImageBytes`), so most real photos were skipped. Cloudinary makes
 * a copy on request from a transformation written into the delivery address:
 * the original is not touched, the copy is cached by Cloudinary, and a model
 * needs no more than 2048 pixels on the longest side to say what is in it.
 * Measured on the 3.46 MB photo of 2026-11-21, a 4000×3000 JPEG: 180 kB at
 * 1536×2048. The copy is also turned the way its EXIF says, as a phone means.
 *
 * Supabase Storage can do the same only on a paid plan, so a large picture
 * there is still skipped with its reason.
 */

/** Longest side, a JPEG, at the quality Cloudinary picks for the picture. */
export const DESCRIBE_COPY = 'c_limit,w_2048,h_2048,q_auto,f_jpg';
/** What the copy is, whatever the original was: `f_jpg` above. */
export const DESCRIBE_COPY_TYPE = 'image/jpeg';

/**
 * The address of the smaller copy, or null for an address that is not a
 * Cloudinary image's. Ownership is not checked here: the caller has already
 * held the address to the caller's own folder (`cloudinaryUrlIsOwned`).
 */
export function cloudinaryCopyForDescribing(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const marker = '/image/upload/';
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'res.cloudinary.com') return null;
  const at = parsed.pathname.indexOf(marker);
  if (at === -1) return null;
  const cut = at + marker.length;
  parsed.pathname = `${parsed.pathname.slice(0, cut)}${DESCRIBE_COPY}/${parsed.pathname.slice(cut)}`;
  return parsed.toString();
}
