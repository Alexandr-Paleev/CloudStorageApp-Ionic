import { describe, it, expect } from 'vitest';
import { TIER_LIMITS, DEFAULT_STORAGE_LIMIT } from './tiers';

describe('TIER_LIMITS', () => {
  it('matches the byte counts the database was migrated with', () => {
    // migrations/001 sets storage_limit DEFAULT 524288000 on profiles, and the
    // webhook writes these numbers into existing rows. Drift here would leave
    // new and upgraded accounts on different limits.
    expect(TIER_LIMITS.free.storage_limit).toBe(524288000);
    expect(TIER_LIMITS.pro.storage_limit).toBe(5368709120);
  });

  it('gives Pro more room than Free', () => {
    expect(TIER_LIMITS.pro.storage_limit).toBeGreaterThan(TIER_LIMITS.free.storage_limit);
  });

  it('never takes a provider away on upgrade', () => {
    for (const provider of TIER_LIMITS.free.allowed_providers) {
      expect(TIER_LIMITS.pro.allowed_providers).toContain(provider);
    }
  });

  it('keeps Dropbox out of the free tier', () => {
    // Dropbox is the paid tier's differentiator; letting it leak into free
    // would be invisible until someone noticed they were not paying for it.
    expect(TIER_LIMITS.free.allowed_providers).not.toContain('dropbox');
    expect(TIER_LIMITS.pro.allowed_providers).toContain('dropbox');
  });
});

describe('DEFAULT_STORAGE_LIMIT', () => {
  it('falls back to free, never to something more generous', () => {
    expect(DEFAULT_STORAGE_LIMIT).toBe(TIER_LIMITS.free.storage_limit);
    expect(DEFAULT_STORAGE_LIMIT).toBeLessThan(TIER_LIMITS.pro.storage_limit);
  });
});
