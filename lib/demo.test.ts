import { describe, it, expect } from 'vitest';
import {
  DEMO_EMAIL_PREFIX,
  DEMO_SEED,
  DEMO_TTL_MS,
  RateLimiter,
  clientIp,
  demoEmail,
  demoPassword,
  demoStoragePath,
  isDemoEmail,
  isExpiredDemoUser,
} from './demo';

describe('demoEmail', () => {
  it('carries the prefix the sweep looks for', () => {
    expect(demoEmail(1_700_000_000_000, () => 0.5)).toMatch(new RegExp(`^${DEMO_EMAIL_PREFIX}`));
  });

  it('does not collide when two visitors arrive in the same millisecond', () => {
    const values = new Set([
      demoEmail(1_700_000_000_000, () => 0.111111),
      demoEmail(1_700_000_000_000, () => 0.999999),
    ]);
    expect(values.size).toBe(2);
  });
});

describe('demoPassword', () => {
  it('is long enough that Supabase accepts it', () => {
    expect(demoPassword(() => 0.42).length).toBeGreaterThanOrEqual(12);
  });
});

describe('isDemoEmail', () => {
  it.each([
    ['demo-123-abc@example.com', true],
    // The e2e suite creates accounts on the same domain. Deleting one mid-run
    // would fail a test that has nothing to do with the demo.
    ['e2e-123-abc@example.com', false],
    ['someone@example.com', false],
    [undefined, false],
  ])('%s -> %s', (email, expected) => {
    expect(isDemoEmail(email as string | undefined)).toBe(expected);
  });
});

describe('isExpiredDemoUser', () => {
  const now = Date.parse('2026-08-31T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('sweeps a demo account past its lifetime', () => {
    const user = { email: 'demo-1@example.com', created_at: ago(DEMO_TTL_MS + 1000) };
    expect(isExpiredDemoUser(user, now)).toBe(true);
  });

  it('leaves a demo account that is still young', () => {
    const user = { email: 'demo-1@example.com', created_at: ago(DEMO_TTL_MS - 1000) };
    expect(isExpiredDemoUser(user, now)).toBe(false);
  });

  it('never touches a real account, however old', () => {
    const user = { email: 'someone@example.com', created_at: ago(DEMO_TTL_MS * 365) };
    expect(isExpiredDemoUser(user, now)).toBe(false);
  });

  it('leaves a row whose created_at is missing or unparsable', () => {
    expect(isExpiredDemoUser({ email: 'demo-1@example.com' }, now)).toBe(false);
    expect(isExpiredDemoUser({ email: 'demo-1@example.com', created_at: 'nope' }, now)).toBe(false);
  });
});

describe('demoStoragePath', () => {
  it('puts the owner in the first segment, which is what migration 006 checks', () => {
    expect(demoStoragePath('user-1', 'a.png', 111)).toBe('user-1/111_a.png');
  });

  it('replaces the characters supabase-storage.service.ts replaces', () => {
    expect(demoStoragePath('user-1', 'Welcome to Cloud Storage.pdf', 111)).toBe(
      'user-1/111_Welcome_to_Cloud_Storage.pdf'
    );
  });
});

describe('DEMO_SEED', () => {
  it('shows files on the dashboard and proves folder scoping', () => {
    expect(DEMO_SEED.some((f) => f.location === 'root')).toBe(true);
    expect(DEMO_SEED.some((f) => f.location === 'folder')).toBe(true);
  });

  it('names assets that exist under public/demo', async () => {
    const { existsSync } = await import('node:fs');
    for (const item of DEMO_SEED) {
      expect(existsSync(new URL(`../public/demo/${item.asset}`, import.meta.url))).toBe(true);
    }
  });
});

describe('RateLimiter', () => {
  it('allows up to the limit and then refuses', () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.allow('a', 0)).toBe(true);
    expect(limiter.allow('a', 1)).toBe(true);
    expect(limiter.allow('a', 2)).toBe(false);
  });

  it('counts each caller separately', () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.allow('a', 0)).toBe(true);
    expect(limiter.allow('b', 0)).toBe(true);
    expect(limiter.allow('a', 0)).toBe(false);
  });

  it('forgets hits once the window has passed', () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.allow('a', 0)).toBe(true);
    expect(limiter.allow('a', 500)).toBe(false);
    expect(limiter.allow('a', 1001)).toBe(true);
  });

  it('drops keys that have gone quiet instead of growing forever', () => {
    const limiter = new RateLimiter(1, 1000);
    limiter.allow('gone', 0);
    limiter.allow('here', 2000);
    // 'gone' has aged out, so its budget is fresh rather than remembered.
    expect(limiter.allow('gone', 2000)).toBe(true);
  });
});

describe('clientIp', () => {
  it('takes the original client from a proxy chain', () => {
    expect(clientIp({ 'x-forwarded-for': '203.0.113.9, 70.41.3.18' })).toBe('203.0.113.9');
  });

  it('handles the header arriving as an array', () => {
    expect(clientIp({ 'x-forwarded-for': ['203.0.113.9'] })).toBe('203.0.113.9');
  });

  it('prefers x-forwarded-for over x-real-ip', () => {
    expect(clientIp({ 'x-forwarded-for': '203.0.113.9', 'x-real-ip': '198.51.100.4' })).toBe(
      '203.0.113.9'
    );
  });

  it('accepts x-real-ip where only that is set', () => {
    expect(clientIp({ 'x-real-ip': '198.51.100.4' })).toBe('198.51.100.4');
  });

  /* Without this the dev server put every caller in one bucket, and the suite
     locked itself out of the route on its fifth run. */
  it('falls back to the socket address when no proxy header is set', () => {
    expect(clientIp({}, '::ffff:127.0.0.1')).toBe('::ffff:127.0.0.1');
  });

  it('falls back to a single bucket only when nothing identifies the caller', () => {
    expect(clientIp({})).toBe('unknown');
  });
});
