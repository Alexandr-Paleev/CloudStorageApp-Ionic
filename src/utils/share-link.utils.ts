import { shareLinkUrl } from '@cloud-storage/core/share-link';

/**
 * Where a share link that arrives at the app has gone: its address on the
 * site, or null for an address that is not a share link.
 *
 * The app opened share links itself, at `/s/` and the token, until step 5 of
 * decision 0014. Links issued then keep that address for as long as they
 * live, so it has to go on leading somewhere. No link lives longer than
 * `MAX_SHARE_DAYS` in `libs/server/src/share.ts`, 365, so the last of them
 * is dead a year after the functions stopped issuing links here. After that
 * this, the line in `main.tsx` that calls it and the redirect in
 * `vercel.json` send nobody anywhere.
 *
 * The token is passed on as the address wrote it. What it leads to is always
 * a page of the site: nothing in the address chooses the host.
 */
export function movedShareLink(pathname: string): string | null {
  const token = /^\/s\/([^/]+)\/?$/.exec(pathname)?.[1];
  return token ? shareLinkUrl(token) : null;
}
