import { isSafeHttpUrl } from '@cloud-storage/core/safe-url';

/**
 * Asks for the file a share link opens. This is the half of the page that
 * runs in the visitor's browser.
 *
 * The page itself is rendered on a server from a description, and holds no
 * address for the file: `share.ts`. The address is signed when a person
 * presses the button, and it is their browser that asks, so the request is
 * counted against them and not against this site, and a link taken back a
 * moment ago is refused here even while the page still names the file.
 */

export type Opening =
  /** An address for the file, which is safe to go to. */
  | { outcome: 'address'; url: string }
  /** The link opens nothing, and asking again will not change that. */
  | { outcome: 'ended'; message: string }
  /** It did not work this time, and asking again may. */
  | { outcome: 'failed'; message: string };

function said(body: unknown): string | null {
  const message = (body as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message ? message : null;
}

export async function askForAddress(from: string): Promise<Opening> {
  let response: Response;
  try {
    /* With no headers of its own. A request that carries one is asked about
       first, in a preflight, and the functions answer this site's preflight
       with nothing: it is a reader of one route, and a plain GET is all a
       reader is given. */
    response = await fetch(from);
  } catch {
    return {
      outcome: 'failed',
      message: 'Could not reach the server. Check your connection and try again.',
    };
  }

  const body: unknown = await response.json().catch(() => null);

  if (response.status === 404 || response.status === 410) {
    return { outcome: 'ended', message: said(body) ?? 'This link no longer opens' };
  }

  if (!response.ok) {
    return {
      outcome: 'failed',
      message: said(body) ?? 'The file could not be opened. Try again in a moment.',
    };
  }

  /* The functions refuse to hand out anything but an http(s) address, and
     this asks again before the browser is sent there. It is the last place
     the value is still text: `location.assign` would run a `javascript:`
     address as script on this page. */
  const url = (body as { downloadUrl?: unknown } | null)?.downloadUrl;
  if (typeof url !== 'string' || !isSafeHttpUrl(url)) {
    return {
      outcome: 'ended',
      message: 'This file cannot be downloaded: its stored location is not a usable address',
    };
  }

  return { outcome: 'address', url };
}
