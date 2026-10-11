import { SITE_ORIGIN } from './origins';

/**
 * Where a share link is opened: on the site, at `/s/` and the token.
 *
 * Until step 5 of decision 0014 the page was the app's, and the functions
 * built a link's address from the request that asked for one. That is how a
 * link made in a native shell came to point at the phone that made it, and
 * why an origin a request merely claimed had to be told from the
 * deployment's own. A link's address is no longer learned from a request at
 * all. It is this.
 *
 * Two sides call it. The functions, to issue a link. And the app, to send
 * on whoever arrives with a link at the address it used to open them at.
 *
 * The token is put in as it is given. One the functions made is 32 random
 * bytes in base64url, which needs no escaping. One read off an address is
 * already written the way an address writes it.
 */
export function shareLinkUrl(token: string): string {
  return `${SITE_ORIGIN}/s/${token}`;
}
