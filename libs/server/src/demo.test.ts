import { describe, it, expect, vi } from 'vitest';
import {
  DEMO_EMAIL_PREFIX,
  DEMO_SEED,
  DEMO_TTL_MS,
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
    expect(demoPassword().length).toBeGreaterThanOrEqual(12);
  });

  it('has every kind of character a password policy can ask for', () => {
    const password = demoPassword();
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/[0-9]/);
    expect(password).toMatch(/[^A-Za-z0-9]/);
  });

  it('does not come from Math.random', () => {
    const random = vi.spyOn(Math, 'random');
    try {
      demoPassword();
      expect(random).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }
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
    // People. Sign-up is open by e-mail and through Google, and these are
    // addresses their owners can confirm; the sweep erases what matches.
    ['demo-anna@company.com', false],
    ['demo-1700000000000-abc@gmail.com', false],
    ['demo-1700000000000-abc@example.com.evil.io', false],
  ])('%s -> %s', (email, expected) => {
    expect(isDemoEmail(email as string | undefined)).toBe(expected);
  });

  it('recognises every address the demo makes', () => {
    for (const random of [() => 0.5, () => 0.123456789, Math.random]) {
      expect(isDemoEmail(demoEmail(Date.now(), random))).toBe(true);
    }
  });
});

describe('isExpiredDemoUser', () => {
  const now = Date.parse('2026-08-31T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('sweeps a demo account past its lifetime', () => {
    const user = { email: 'demo-1-a@example.com', created_at: ago(DEMO_TTL_MS + 1000) };
    expect(isExpiredDemoUser(user, now)).toBe(true);
  });

  it('leaves a demo account that is still young', () => {
    const user = { email: 'demo-1-a@example.com', created_at: ago(DEMO_TTL_MS - 1000) };
    expect(isExpiredDemoUser(user, now)).toBe(false);
  });

  it('never touches a real account, however old', () => {
    const user = { email: 'someone@example.com', created_at: ago(DEMO_TTL_MS * 365) };
    expect(isExpiredDemoUser(user, now)).toBe(false);
  });

  it('never touches a real account whose name happens to begin like a demo', () => {
    const user = { email: 'demo-anna@company.com', created_at: ago(DEMO_TTL_MS * 2) };
    expect(isExpiredDemoUser(user, now)).toBe(false);
  });

  it('leaves a row whose created_at is missing or unparsable', () => {
    expect(isExpiredDemoUser({ email: 'demo-1-a@example.com' }, now)).toBe(false);
    expect(isExpiredDemoUser({ email: 'demo-1-a@example.com', created_at: 'nope' }, now)).toBe(
      false
    );
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
      expect(existsSync(new URL(`../../../public/demo/${item.asset}`, import.meta.url))).toBe(true);
    }
  });
});
