import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { isNativePlatform } = vi.hoisted(() => ({ isNativePlatform: vi.fn(() => false) }));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNativePlatform() },
}));

import { apiUrl } from './api.utils';

describe('apiUrl', () => {
  beforeEach(() => {
    isNativePlatform.mockReturnValue(false);
    vi.stubEnv('VITE_API_ORIGIN', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  /* The web app calls its own deployment, whichever one that is: a preview
     build must not send its uploads to production. */
  it('leaves the path alone in a browser', () => {
    expect(apiUrl('/api/share')).toBe('/api/share');
  });

  it('leaves it alone in a browser even when an origin is configured', () => {
    vi.stubEnv('VITE_API_ORIGIN', 'https://cloud-storage-app-ionic-v0.vercel.app');
    expect(apiUrl('/api/share')).toBe('/api/share');
  });

  it('names the deployment out loud in the native shell', () => {
    isNativePlatform.mockReturnValue(true);
    vi.stubEnv('VITE_API_ORIGIN', 'https://cloud-storage-app-ionic-v0.vercel.app');

    expect(apiUrl('/api/demo/session')).toBe(
      'https://cloud-storage-app-ionic-v0.vercel.app/api/demo/session'
    );
  });

  /* A trailing slash in .env is the likeliest way to configure this wrong, and
     '//api/share' is a 404 that reads like a typo rather than a mistake. */
  it('does not double the slash when the origin ends in one', () => {
    isNativePlatform.mockReturnValue(true);
    vi.stubEnv('VITE_API_ORIGIN', 'https://example.com/');

    expect(apiUrl('/api/share')).toBe('https://example.com/api/share');
  });

  /* Without it there is nothing to fall back to but the relative path, which
     is at least the behaviour the browser has — a 404 in the shell, not a
     request to "undefined/api/share". */
  it('falls back to the relative path when no origin is configured', () => {
    isNativePlatform.mockReturnValue(true);
    expect(apiUrl('/api/share')).toBe('/api/share');
  });

  it('keeps a query string intact', () => {
    isNativePlatform.mockReturnValue(true);
    vi.stubEnv('VITE_API_ORIGIN', 'https://example.com');

    expect(apiUrl('/api/share?token=abc')).toBe('https://example.com/api/share?token=abc');
  });
});
