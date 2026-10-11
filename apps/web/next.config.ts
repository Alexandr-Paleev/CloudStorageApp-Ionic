import type { NextConfig } from 'next';

/**
 * The app's address, for the one line of the policy below that names it.
 *
 * It is `APP_ORIGIN` in `lib/site.ts`, written out a second time, because
 * this file cannot import that one. Next compiles its config apart from the
 * site, and resolves the `baseUrl` of a tsconfig against the folder it runs
 * in. Ours is declared two folders up, in `tsconfig.base.json`, so
 * `@cloud-storage/core` leads nowhere from here: the build stops on it.
 *
 * `next.config.test.ts` holds this copy to the one in `libs/core`, and the
 * smoke test holds the policy to the address the page really asks.
 */
const APP_ORIGIN = (
  process.env.NEXT_PUBLIC_APP_ORIGIN ?? 'https://cloud-storage-app-ionic-v0.vercel.app'
).replace(/\/$/, '');

/**
 * The headers the app sends from `vercel.json`, for the pages this site
 * serves. The policy is narrower than the app's because the site is: it
 * loads nothing from another origin, and one page of it talks to one.
 *
 * That page is the one a share link opens. Its button asks the app's
 * functions for the file, from the visitor's browser, so `connect-src` names
 * the app there and nowhere else.
 *
 * `'unsafe-inline'` for scripts is the price of prerendering. Next writes
 * its bootstrap inline, and a nonce would have to be minted per request,
 * which means rendering every page on demand. Four of the five pages take
 * no input and show nothing a visitor wrote. The share page does show
 * something a stranger wrote, the name its owner gave the file, and it is
 * rendered on demand, so it could carry a nonce. It does not yet. What
 * stands between that name and a script is React, which writes it out as
 * text. And the page is on an origin where nobody is signed in: as a page
 * of the app, the same name was shown beside a session.
 *
 * Development is left out. React's refresh needs `eval`, and a policy that
 * differs between `next dev` and production would only be tested in one.
 */
const policy = (...talksTo: string[]) =>
  [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    ["connect-src 'self'", ...talksTo].join(' '),
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

/**
 * The address of a share page is all it takes to read the file, so the page
 * belongs in no index, whatever it turns out to show.
 *
 * The page says so itself, in a tag. It is said here as well because here
 * it holds for every answer at that address, a 404 included, and because
 * this one can be seen missing: the layout puts the same tag on every page
 * of a deployment that is not production, and that is the only kind a test
 * of the page's own tag ever runs against.
 */
const NOT_TO_BE_INDEXED = { key: 'X-Robots-Tag', value: 'noindex, nofollow' };

const config: NextConfig = {
  /* Nothing here needs to say what served it. */
  poweredByHeader: false,

  async headers() {
    const csp = (...talksTo: string[]) =>
      process.env.NODE_ENV === 'production'
        ? [{ key: 'Content-Security-Policy', value: policy(...talksTo) }]
        : [];

    return [
      { source: '/:path*', headers: [...SECURITY_HEADERS, ...csp()] },
      /* After the rule above, because of two that set one header the later
         is the one that is sent. */
      { source: '/s/:token', headers: [NOT_TO_BE_INDEXED, ...csp(APP_ORIGIN)] },
    ];
  },
};

export default config;
