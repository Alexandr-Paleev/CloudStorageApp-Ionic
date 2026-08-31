import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCsp, allows, type CspDirectives } from './csp';

interface VercelConfig {
  headers: { source: string; headers: { key: string; value: string }[] }[];
}

const config = JSON.parse(
  readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')
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

  it('expands a wildcard host to one label, as a browser does', () => {
    expect(allows(policy, 'script-src', 'https://static.hotjar.com')).toBe(true);
    expect(allows(policy, 'script-src', 'https://a.b.hotjar.com')).toBe(false);
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

  it('allows the Google Fonts stylesheet index.html links to', () => {
    expect(allows(directives, 'style-src', 'https://fonts.googleapis.com')).toBe(true);
    expect(allows(directives, 'font-src', 'https://fonts.gstatic.com')).toBe(true);
  });

  it('allows the Stripe pages billing redirects to be framed', () => {
    expect(allows(directives, 'frame-src', 'https://checkout.stripe.com')).toBe(true);
    expect(allows(directives, 'frame-src', 'https://billing.stripe.com')).toBe(true);
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

  /* Honest about the weak spot: gtag.js and Hotjar both evaluate inline script,
     so 'unsafe-inline' has to stay until the app can emit a per-request nonce —
     which needs a server rendering the HTML, not a static bundle. The app's own
     build emits no inline <script> at all, so this is entirely the price of the
     two analytics vendors. */
  it("documents that script-src still carries 'unsafe-inline'", () => {
    expect(directives['script-src']).toContain("'unsafe-inline'");
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
