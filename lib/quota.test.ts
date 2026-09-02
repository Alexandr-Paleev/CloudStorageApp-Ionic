import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockSupabase, type TableAnswer } from './test-utils';
import { TIER_LIMITS, DEFAULT_STORAGE_LIMIT } from './tiers';

const { db } = vi.hoisted(() => ({
  db: { client: null as { from: (table: string) => unknown } | null },
}));

vi.mock('./auth', () => ({
  supabase: { from: (table: string) => db.client!.from(table) },
}));

import { readQuota, quotaRejection } from './quota';

function profiles(answer: TableAnswer) {
  db.client = mockSupabase({ profiles: answer }).client;
}

const MB = 1024 * 1024;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('readQuota', () => {
  it('reads the limit and the counter off the profile', async () => {
    profiles({ data: [{ storage_limit: TIER_LIMITS.pro.storage_limit, bytes_used: 42 * MB }] });

    await expect(readQuota('user-1')).resolves.toEqual({
      limit: TIER_LIMITS.pro.storage_limit,
      used: 42 * MB,
    });
  });

  it('falls back to the free plan only when there is no row at all', async () => {
    profiles({ data: [] });

    await expect(readQuota('user-1')).resolves.toEqual({ limit: DEFAULT_STORAGE_LIMIT, used: 0 });
  });

  it('throws rather than assume a limit when the read fails', async () => {
    // Defaulting here would cap a Pro user at the free tier and refuse a
    // legitimate upload with 413.
    profiles({ error: { message: 'connection reset' } });

    await expect(readQuota('user-1')).rejects.toThrow(/connection reset/);
  });

  it('names the migration when the column is not there yet', async () => {
    profiles({ error: { message: 'column profiles.bytes_used does not exist' } });

    await expect(readQuota('user-1')).rejects.toThrow(/migrations\/007/);
  });
});

describe('quotaRejection', () => {
  it('lets through a file that fits exactly', () => {
    expect(quotaRejection({ limit: 100, used: 40 }, 60)).toBeNull();
  });

  it('refuses the byte past the limit', () => {
    expect(quotaRejection({ limit: 100, used: 40 }, 61)).toMatch(/Storage limit exceeded/);
  });

  it('counts the incoming file, not only what is stored', () => {
    expect(quotaRejection({ limit: 100, used: 100 }, 1)).not.toBeNull();
  });

  it('speaks in units, not raw byte counts', () => {
    const message = quotaRejection(
      { limit: TIER_LIMITS.free.storage_limit, used: 495 * MB },
      10 * MB
    );

    expect(message).toContain('500.0 MB');
    expect(message).not.toMatch(/\d{7,}/);
  });

  it('says how far past the limit a downgraded account already is', () => {
    // Cancelling Pro drops the limit to 500 MB without deleting anything.
    const message = quotaRejection(
      { limit: TIER_LIMITS.free.storage_limit, used: 3 * 1024 * MB },
      1
    );

    expect(message).toMatch(/over the limit/);
  });

  it('does not add that sentence when the account is merely full', () => {
    expect(quotaRejection({ limit: 100, used: 100 }, 1)).not.toMatch(/over the limit/);
  });
});
