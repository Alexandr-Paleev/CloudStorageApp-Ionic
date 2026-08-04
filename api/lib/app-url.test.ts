import { describe, it, expect, afterEach } from 'vitest';
import type { VercelRequest } from '@vercel/node';
import { getAppUrl } from './app-url';

const requestWith = (origin?: string) =>
  ({ headers: origin ? { origin } : {} }) as unknown as VercelRequest;

describe('getAppUrl', () => {
  const original = process.env.VERCEL_PROJECT_PRODUCTION_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    else process.env.VERCEL_PROJECT_PRODUCTION_URL = original;
  });

  it('prefers Origin, so a preview deployment redirects back to itself', () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'example.com';
    expect(getAppUrl(requestWith('https://preview-abc.vercel.app'))).toBe(
      'https://preview-abc.vercel.app'
    );
  });

  it("falls back to Vercel's production URL when Origin is absent", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'example.com';
    expect(getAppUrl(requestWith())).toBe('https://example.com');
  });

  it('throws rather than building an "undefined/..." redirect', () => {
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    expect(() => getAppUrl(requestWith())).toThrow(/Cannot determine app URL/);
  });
});
