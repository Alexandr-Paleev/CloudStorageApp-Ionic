import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCsp, allows, type CspDirectives } from './csp';

interface VercelConfig {
  headers: { source: string; headers: { key: string; value: string }[] }[];
}

const config = JSON.parse(
  readFileSync(new URL('../../../vercel.json', import.meta.url), 'utf8')
) as VercelConfig;

function headerValue(name: string): string {
  for (const rule of config.headers) {
    const found = rule.headers.find((h) => h.key.toLowerCase() === name.toLowerCase());
    if (found) return found.value;
  }
  throw new Error(`vercel.json sends no ${name} header`);
}

const directives: CspDirectives = parseCsp(headerValue('Content-Security-Policy'));

describe('parseCsp', () => {
  it('splits a policy into directives and their sources', () => {
    expect(parseCsp("default-src 'self'; img-src 'self' data:")).toEqual({
      'default-src': ["'self'"],
      'img-src': ["'self'", 'data:'],
    });
  });

  it('keeps a directive that carries no sources', () => {
    expect(parseCsp('upgrade-insecure-requests')).toEqual({ 'upgrade-insecure-requests': [] });
  });
});

describe('allows', () => {
  const policy = parseCsp("script-src 'self' https://*.hotjar.com; default-src https:");

  it('matches an exact origin', () => {
    expect(allows(policy, 'script-src', 'https://*.hotjar.com')).toBe(true);
  });

  it('expands a wildcard host to a subdomain at any depth, as a browser does', () => {
    expect(allows(policy, 'script-src', 'https://static.hotjar.com')).toBe(true);
    expect(allows(policy, 'script-src', 'https://a.b.hotjar.com')).toBe(true);
    expect(allows(policy, 'script-src', 'https://hotjar.com')).toBe(false);
    expect(allows(policy, 'script-src', 'https://nothotjar.com')).toBe(false);
  });

  it('falls back to default-src for a directive the policy omits', () => {
    expect(allows(policy, 'connect-src', 'https://api.example.com')).toBe(true);
  });
});

/**
 * The origins below are not decoration: each one is a script this app injects
 * at runtime, and a policy that forgets one breaks that integration in
 * production only. Adding a third-party script means adding it here too.
 */
describe('the shipped policy', () => {
  it.each([
    // src/services/googledrive-auth.service.ts injects the GIS client
    ['https://accounts.google.com', 'Google Identity Services'],
    // gtag.js, loaded by react-ga4
    ['https://www.googletagmanager.com', 'Google Analytics 4'],
    // src/analytics/hotjar.ts injects static.hotjar.com
    ['https://static.hotjar.com', 'Hotjar'],
  ])('allows scripts from %s (%s)', (origin) => {
    expect(allows(directives, 'script-src', origin)).toBe(true);
  });

  /* Inter is served by the app (src/theme/fonts.css). It came from Google
     Fonts, and a font host left in the policy would be a door that nothing
     the app loads goes through. */
  it('takes fonts and stylesheets from the app, and from no font host', () => {
    expect(directives['font-src']).toContain("'self'");
    expect(allows(directives, 'style-src', 'https://fonts.googleapis.com')).toBe(false);
    expect(allows(directives, 'font-src', 'https://fonts.gstatic.com')).toBe(false);
  });

  it('allows the Stripe pages billing redirects to be framed', () => {
    expect(allows(directives, 'frame-src', 'https://checkout.stripe.com')).toBe(true);
    expect(allows(directives, 'frame-src', 'https://billing.stripe.com')).toBe(true);
  });

  /* src/pages/FileView.tsx shows a PDF in an <iframe> pointed at the file's own
     URL. From 4.0.0 to 4.7.2 this directive named only Stripe and Google, and
     Chrome answered every preview with "This content is blocked" — the demo's
     welcome.pdf included. */
  it.each([
    ['https://fhcpgsenptnwimwimjka.supabase.co', 'Supabase Storage'],
    ['https://mybucket.0123456789abcdef.r2.cloudflarestorage.com', 'an R2 presigned URL'],
    ['https://res.cloudinary.com', 'Cloudinary'],
  ])('allows a PDF preview to be framed from %s (%s)', (origin) => {
    expect(allows(directives, 'frame-src', origin)).toBe(true);
  });

  it('refuses a script origin nobody asked for', () => {
    expect(allows(directives, 'script-src', 'https://evil.example')).toBe(false);
  });

  /* The four that cost nothing and are worth the most: clickjacking, a
     rewritten <base>, a plugin, and a form posting credentials elsewhere. */
  it('locks down the directives that carry no compatibility risk', () => {
    expect(directives['frame-ancestors']).toEqual(["'none'"]);
    expect(directives['object-src']).toEqual(["'none'"]);
    expect(directives['base-uri']).toEqual(["'self'"]);
    expect(directives['form-action']).toEqual(["'self'"]);
  });

  /* The build emits no inline <script>, and gtag.js and Hotjar, which this test
     used to say needed one, run without: on production on 2026-10-23, a yes to
     analytics, a demo account, a PDF preview, two uploads and the account's
     deletion drew no inline violation under this policy, with Hotjar's loader
     and its modules fetched each time. A vendor that starts injecting inline
     script will be refused, which is the point. */
  it('runs no inline script, and evaluates none', () => {
    expect(directives['script-src']).not.toContain("'unsafe-inline'");
    expect(directives['script-src']).not.toContain("'unsafe-eval'");
  });

  it('loads scripts from no Google host the app does not use', () => {
    // gapi was loaded from here once; nothing has injected it since.
    expect(allows(directives, 'script-src', 'https://apis.google.com')).toBe(false);
  });

  /* Each a host the browser sends requests to. Named by vendor, with a wildcard
     where the host differs per deployment (the Supabase project, the R2
     account, the Sentry organisation): vercel.json is checked in, and a fork
     with its own project must not have its uploads refused. */
  it.each([
    ['https://fhcpgsenptnwimwimjka.supabase.co', 'Supabase: data, auth and Storage'],
    ['https://api.cloudinary.com', 'Cloudinary uploads (cloudinary.service.ts)'],
    ['https://mybucket.0123456789abcdef.r2.cloudflarestorage.com', 'R2 presigned uploads'],
    ['https://www.googleapis.com', 'Google Drive (googledrive.service.ts)'],
    ['https://accounts.google.com', 'Google Identity Services'],
    ['https://api.dropboxapi.com', 'Dropbox'],
    ['https://content.dropboxapi.com', 'Dropbox uploads'],
    ['https://o4510651572748288.ingest.de.sentry.io', 'Sentry'],
    ['https://region1.google-analytics.com', 'Google Analytics hits'],
    ['https://www.googletagmanager.com', 'gtag.js'],
    ['https://vc.hotjar.io', 'Hotjar'],
    ['wss://ws.hotjar.com', 'Hotjar recordings'],
  ])('lets the app connect to %s (%s)', (origin) => {
    expect(allows(directives, 'connect-src', origin)).toBe(true);
  });

  /* It was `https: wss:`, which refused nothing: a script injected into the
     page could have sent what it read to any host on the internet. */
  it('connects to no host nobody asked for', () => {
    expect(directives['connect-src']).not.toContain('https:');
    expect(directives['connect-src']).not.toContain('wss:');
    expect(allows(directives, 'connect-src', 'https://evil.example')).toBe(false);
  });
});

describe('the other hardening headers', () => {
  it.each([
    ['X-Content-Type-Options', 'nosniff'],
    ['X-Frame-Options', 'DENY'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ])('sends %s: %s', (name, expected) => {
    expect(headerValue(name)).toBe(expected);
  });

  it('sends an HSTS max-age of at least a year', () => {
    const maxAge = Number(/max-age=(\d+)/.exec(headerValue('Strict-Transport-Security'))?.[1]);
    expect(maxAge).toBeGreaterThanOrEqual(31536000);
  });

  /* Google sign-in opens a popup and needs the opener reference kept, so this
     cannot be tightened to plain same-origin without breaking Drive auth. */
  it('keeps popups usable for Google sign-in', () => {
    expect(headerValue('Cross-Origin-Opener-Policy')).toBe('same-origin-allow-popups');
  });
});
