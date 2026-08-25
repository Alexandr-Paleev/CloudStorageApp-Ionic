import { describe, it, expect } from 'vitest';
import { formatBytes } from './format';

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
