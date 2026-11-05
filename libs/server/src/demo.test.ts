import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DEMO_ADDRESS_PATTERN,
  DEMO_EMAIL_PREFIX,
  DEMO_EVICT_AFTER_MS,
  DEMO_LIVE_LIMIT,
  DEMO_SEED,
  DEMO_STORAGE_LIMIT,
  DEMO_TTL_MS,
  demoEmail,
  demoPassword,
  demoStoragePath,
  givesUpItsPlace,
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

describe('givesUpItsPlace', () => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('gives a place held for more than an hour to a visitor who finds the demo full', () => {
    expect(givesUpItsPlace(ago(DEMO_EVICT_AFTER_MS + 1000), now)).toBe(true);
  });

  it('keeps a place held for less, which is a demo likely still in use', () => {
    expect(givesUpItsPlace(ago(DEMO_EVICT_AFTER_MS - 1000), now)).toBe(false);
  });

  it('keeps a place whose time cannot be read', () => {
    expect(givesUpItsPlace('nope', now)).toBe(false);
  });

  /* Shorter than the sweep's day, or nothing would ever be taken; at least
     the hour a demo needs, or a visitor would lose one in use. */
  it('is an hour, between a demo in use and the sweep', () => {
    expect(DEMO_EVICT_AFTER_MS).toBe(60 * 60 * 1000);
    expect(DEMO_EVICT_AFTER_MS).toBeLessThan(DEMO_TTL_MS);
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

/* SQL cannot import a constant: migration 019 writes both limits and the
   address a second time, and this is what notices when they stop agreeing. */
describe('what the database holds demo accounts to', () => {
  const migration = readFileSync(
    new URL('../../../migrations/019_hold_demo_storage.sql', import.meta.url),
    'utf8'
  );

  it('stores DEMO_STORAGE_LIMIT, 10 MB, in each', () => {
    expect(DEMO_STORAGE_LIMIT).toBe(10 * 1024 * 1024);
    expect(migration).toContain(`LEAST(NEW.storage_limit, ${DEMO_STORAGE_LIMIT})`);
    expect(migration).toContain(`SET storage_limit = ${DEMO_STORAGE_LIMIT}`);
  });

  /* The route tells a full demo from any other refusal by counting again,
     so its count and the trigger's have to agree on both the number and
     the accounts. */
  it('lets DEMO_LIVE_LIMIT, 20, exist at once', () => {
    expect(DEMO_LIVE_LIMIT).toBe(20);
    expect(migration).toContain(`>= ${DEMO_LIVE_LIMIT} THEN`);
  });

  /* Postgres reads `~` with the same syntax for everything this pattern
     uses, so the trigger's pattern is run here as it is written there. */
  it('reaches the accounts isDemoEmail calls demo accounts, and no other', () => {
    const patterns = [...migration.matchAll(/email ~ '([^']+)'/g)].map((match) => match[1]);
    // Two triggers' WHEN, the count, and the update of the accounts there are.
    expect(patterns).toHaveLength(4);
    expect(new Set(patterns).size).toBe(1);
    expect(patterns[0]).toBe(DEMO_ADDRESS_PATTERN);

    const database = new RegExp(patterns[0] ?? '');
    for (const address of [
      demoEmail(),
      'demo-1700000000-ab12@example.com',
      'demo-1700000000-@example.com',
      'demo-anna@company.com',
      'demo-1700000000-AB12@example.com',
      'demo-1700000000-ab12@example.com.evil.net',
      'e2e-1700000000-ab12@example.com',
      'person@company.com',
    ]) {
      expect(database.test(address), address).toBe(isDemoEmail(address));
    }
  });
});
