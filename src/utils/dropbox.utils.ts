/**
 * create_shared_link_with_settings returns a preview page (…?dl=0), not the
 * file itself. raw=1 serves the content, which is what <img> previews and
 * downloads need. Anything that is not a URL is passed through untouched.
 */
export function toDirectLink(sharedUrl: string): string {
  try {
    const url = new URL(sharedUrl);
    url.searchParams.delete('dl');
    url.searchParams.set('raw', '1');
    return url.toString();
  } catch {
    return sharedUrl;
  }
}
