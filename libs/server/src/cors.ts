import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * The origins these functions answer besides their own.
 *
 * On the web the page and the functions share a deployment, so a call to
 * `/api/share` is same-origin and CORS never enters into it. The native shells
 * are the exception the app now has to account for: a Capacitor WebView serves
 * the page from `capacitor://localhost` on iOS and `https://localhost` on
 * Android, so every call to the API is cross-origin, and a browser that is not
 * told otherwise refuses to hand the answer back to the page.
 *
 * Android's scheme is `server.androidScheme` in capacitor.config.ts, `https`
 * since the first commit. This list said `http://localhost` until 2026-09-30,
 * and every `/api` call from that shell failed its preflight while sign-in and
 * the file list, which go straight to Supabase, looked fine. `http://localhost`
 * stays for a shell built with the older scheme.
 *
 * An allowlist rather than `*`. These routes read an `Authorization` header,
 * mint Stripe Checkout sessions and presign uploads; `*` would invite any page
 * on the internet to call them from a signed-in visitor's browser.
 *
 * `ionic://localhost` is there for older shells only — Capacitor has used
 * `capacitor://` on iOS since 3.0, and this costs nothing to keep correct.
 */
const ALLOWED_ORIGINS = new Set([
  'capacitor://localhost',
  'https://localhost',
  'ionic://localhost',
  'http://localhost',
]);

/**
 * What one route adds to the list above.
 *
 * `readers` are origins that may read this route's answer to a GET, and may
 * do nothing else here. A shell is the app, somewhere else: it signs in and
 * sends a token with everything it asks. A reader is another site. It has no
 * session to send, so it is not told it may send an `Authorization` header,
 * and a browser on that origin will then not send a request that carries
 * one. The public site is the one reader there is, on the one route it reads:
 * the page a share link opens asks `/api/share` for the file, from the
 * visitor's browser. See decision 0014.
 */
interface RouteCors {
  readers?: readonly string[];
}

/**
 * Answers the CORS half of a request, and says whether that was all of it.
 *
 * Returns `true` when the request was a preflight and has been answered, so
 * handlers read as `if (applyCors(req, res)) return;` — a preflight carries no
 * `Authorization` header and must never reach the code that expects one.
 */
export function applyCors(req: VercelRequest, res: VercelResponse, route: RouteCors = {}): boolean {
  const origin = req.headers.origin;

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    /* A day, so the shell stops asking before every upload part. */
    res.setHeader('Access-Control-Max-Age', '86400');
  } else if (origin && route.readers?.includes(origin)) {
    /* No Allow-Headers at all. A plain GET needs none and is never
       preflighted. A request that carries a token or a JSON body is, and so
       is a DELETE, and this answer refuses all three. A POST that carries
       neither is one any page on the internet can already send: the
       handlers answer it 401. */
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
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
