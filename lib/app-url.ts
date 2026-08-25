import type { VercelRequest } from '@vercel/node';

/**
 * Base URL to send the user back to after Stripe.
 *
 * Origin comes first so a preview deployment returns to itself instead of
 * production. VERCEL_PROJECT_PRODUCTION_URL is populated by Vercel itself (no
 * configuration needed) and covers requests that arrive without an Origin
 * header, which would otherwise build a redirect to "undefined/...".
 */
export function getAppUrl(req: VercelRequest): string {
  const origin = req.headers.origin;
  if (origin) return origin;

  const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (productionUrl) return `https://${productionUrl}`;

  throw new Error(
    'Cannot determine app URL: no Origin header and no VERCEL_PROJECT_PRODUCTION_URL'
  );
}
