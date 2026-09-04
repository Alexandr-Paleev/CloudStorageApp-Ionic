import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * The origins these functions answer besides their own.
 *
 * On the web the page and the functions share a deployment, so a call to
 * `/api/share` is same-origin and CORS never enters into it. The native shells
 * are the exception the app now has to account for: a Capacitor WebView serves
 * the page from `capacitor://localhost` on iOS and `http://localhost` on
 * Android, so every call to the API is cross-origin, and a browser that is not
 * told otherwise refuses to hand the answer back to the page.
 *
 * An allowlist rather than `*`. These routes read an `Authorization` header,
 * mint Stripe Checkout sessions and presign uploads; `*` would invite any page
 * on the internet to call them from a signed-in visitor's browser.
 *
 * `ionic://localhost` is there for older shells only — Capacitor has used
 * `capacitor://` on iOS since 3.0, and this costs nothing to keep correct.
 */
const ALLOWED_ORIGINS = new Set(['capacitor://localhost', 'ionic://localhost', 'http://localhost']);

/**
 * Answers the CORS half of a request, and says whether that was all of it.
 *
 * Returns `true` when the request was a preflight and has been answered, so
 * handlers read as `if (applyCors(req, res)) return;` — a preflight carries no
 * `Authorization` header and must never reach the code that expects one.
 */
export function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  const origin = req.headers.origin;

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    /* A day, so the shell stops asking before every upload part. */
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  /* Set whether or not the origin matched: the response genuinely differs by
     origin, and a cache that kept the header-less copy would break the app it
     was cached for. */
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }

  return false;
}
