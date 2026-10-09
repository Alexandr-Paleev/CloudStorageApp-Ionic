import type { NextConfig } from 'next';

/**
 * The headers the app sends from `vercel.json`, for the pages this site
 * serves. The policy is narrower than the app's because the site is: it
 * loads nothing from another origin and talks to none.
 *
 * `'unsafe-inline'` for scripts is the price of prerendering. Next writes
 * its bootstrap inline, and a nonce would have to be minted per request,
 * which means rendering every page on demand. These pages take no input and
 * show nothing a visitor wrote, so what the policy is for here is the other
 * half: no script from elsewhere, no frame, no form posted elsewhere.
 *
 * Development is left out. React's refresh needs `eval`, and a policy that
 * differs between `next dev` and production would only be tested in one.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const config: NextConfig = {
  /* Nothing here needs to say what served it. */
  poweredByHeader: false,

  async headers() {
    const headers =
      process.env.NODE_ENV === 'production'
        ? [...SECURITY_HEADERS, { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY }]
        : SECURITY_HEADERS;

    return [{ source: '/:path*', headers }];
  },
};

export default config;
