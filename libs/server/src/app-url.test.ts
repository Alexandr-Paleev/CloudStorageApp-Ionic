import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { VercelRequest } from '@vercel/node';
import { getAppUrl } from './app-url';

const requestWith = (origin?: string) =>
  ({ headers: origin ? { origin } : {} }) as unknown as VercelRequest;

const KEYS = [
  'VERCEL_ENV',
  'VERCEL_PROJECT_PRODUCTION_URL',
  'VERCEL_URL',
  'VERCEL_BRANCH_URL',
] as const;

/** The system variables Vercel sets on a deployment of this project. */
function deployedAs(env: 'production' | 'preview') {
  process.env.VERCEL_ENV = env;
  process.env.VERCEL_PROJECT_PRODUCTION_URL = 'example.com';
  process.env.VERCEL_URL = 'app-abc123.vercel.app';
  if (env === 'preview') process.env.VERCEL_BRANCH_URL = 'app-git-feature.vercel.app';
}

describe('getAppUrl', () => {
  const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

  beforeEach(() => {
    for (const key of KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const key of KEYS) {
      const value = original[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('returns a preview deployment to itself, by either of its addresses', () => {
    deployedAs('preview');
    expect(getAppUrl(requestWith('https://app-abc123.vercel.app'))).toBe(
      'https://app-abc123.vercel.app'
    );
    expect(getAppUrl(requestWith('https://app-git-feature.vercel.app'))).toBe(
      'https://app-git-feature.vercel.app'
    );
  });

  it('keeps the production domain as it came', () => {
    deployedAs('production');
    expect(getAppUrl(requestWith('https://example.com'))).toBe('https://example.com');
  });

  // The shells' own origins. A share link built on one of them pointed at the
  // phone that made it, while links were built here, and the demo fetched its
  // seed assets from it.
  it.each(['capacitor://localhost', 'https://localhost', 'http://localhost'])(
    'answers a native shell (%s) with the production URL',
    (origin) => {
      deployedAs('production');
      expect(getAppUrl(requestWith(origin))).toBe('https://example.com');
    }
  );

  it('does not take a foreign Origin at its word, with a port or without', () => {
    deployedAs('production');
    expect(getAppUrl(requestWith('https://elsewhere.example'))).toBe('https://example.com');
    expect(getAppUrl(requestWith('http://localhost:8100'))).toBe('https://example.com');
  });

  it('trusts a dev server on this machine when nothing is deployed', () => {
    expect(getAppUrl(requestWith('http://localhost:8100'))).toBe('http://localhost:8100');
  });

  it("falls back to Vercel's production URL when Origin is absent", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'example.com';
    expect(getAppUrl(requestWith())).toBe('https://example.com');
  });

  it('throws rather than building an "undefined/..." redirect', () => {
    expect(() => getAppUrl(requestWith())).toThrow(/Cannot determine app URL/);
  });
});
