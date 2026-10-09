import { describe, it, expect } from 'vitest';
import { formatBytes, formatStorage } from './format';
import { TIER_LIMITS } from './tiers';

describe('formatBytes', () => {
  it('scales through the units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe('5.00 GB');
  });

  it('reaches GB for the Pro limit instead of stopping at four digits of MB', () => {
    expect(formatBytes(500 * 1024 * 1024)).toBe('500.0 MB');
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.00 GB');
  });

  it('does not print NaN or a negative size to the user', () => {
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('0 B');
    expect(formatBytes(-1)).toBe('0 B');
  });
});

describe('formatStorage', () => {
  it('states a round limit as the round number it is', () => {
    expect(formatStorage(TIER_LIMITS.free.storage_limit)).toBe('500 MB');
    expect(formatStorage(TIER_LIMITS.pro.storage_limit)).toBe('5 GB');
    expect(formatStorage(2 * 1024)).toBe('2 KB');
    expect(formatStorage(512)).toBe('512 B');
  });

  it('keeps a decimal rather than rounding a limit up', () => {
    expect(formatStorage(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB');
    expect(formatStorage(750.5 * 1024 * 1024)).toBe('750.5 MB');
  });

  it('does not print NaN or a negative size', () => {
    expect(formatStorage(Number.NaN)).toBe('0 B');
    expect(formatStorage(-1)).toBe('0 B');
  });
});
