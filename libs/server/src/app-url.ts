import type { VercelRequest } from '@vercel/node';

/**
 * This deployment's own addresses, as Vercel describes them to the function:
 * the production domain, the deployment's own URL and, on a preview, its
 * branch URL. Each arrives as a bare hostname.
 */
function ownOrigins(): Set<string> {
  const hosts = [
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
  ];
  return new Set(hosts.filter(Boolean).map((host) => `https://${host}`));
}

/**
 * A dev server on this machine — `npm run dev`, or the two the e2e suite
 * starts. Never on a deployment, and only with a port: the native shells'
 * origins, `capacitor://localhost` and `https://localhost`, carry none.
 */
function isLocalDevServer(origin: string): boolean {
  const env = process.env.VERCEL_ENV;
  if (env === 'production' || env === 'preview') return false;

  try {
    const { protocol, port } = new URL(origin);
    return (protocol === 'http:' || protocol === 'https:') && port !== '';
  } catch {
    return false;
  }
}

/**
 * Base URL for the addresses this API hands back: Stripe's return URLs, share
 * links, and the host the demo fetches its seed assets from.
 *
 * Origin comes first so a preview deployment returns to itself instead of
 * production — but only an Origin that is one of this deployment's own. The
 * native shells send `capacitor://localhost` and `https://localhost`: a share
 * link built on either pointed at the phone that made it, and the demo, which
 * fetches its assets from here, seeded nothing in a shell. And a request that
 * merely claimed an Origin could point that fetch at any host at all.
 *
 * Anything else gets VERCEL_PROJECT_PRODUCTION_URL, which Vercel populates
 * itself (no configuration needed). It also covers requests that arrive
 * without an Origin header, which would otherwise build a redirect to
 * "undefined/...".
 */
export function getAppUrl(req: VercelRequest): string {
  const origin = req.headers.origin;
  if (origin && (ownOrigins().has(origin) || isLocalDevServer(origin))) return origin;

  const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (productionUrl) return `https://${productionUrl}`;

  throw new Error(
    'Cannot determine app URL: no trusted Origin header and no VERCEL_PROJECT_PRODUCTION_URL'
  );
}
