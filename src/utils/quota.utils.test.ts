import { describe, it, expect } from 'vitest';
import { storageMeter } from './quota.utils';
import { TIER_LIMITS } from '../../lib/tiers';

const FREE = TIER_LIMITS.free.storage_limit;

describe('storageMeter', () => {
  it('reports an empty account as empty', () => {
    expect(storageMeter(0, FREE)).toMatchObject({
      barWidth: '0.0',
      percentage: '0.0',
      isOverLimit: false,
    });
  });

  it('rounds to a tenth of a percent', () => {
    expect(storageMeter(FREE / 3, FREE).percentage).toBe('33.3');
  });

  it('treats a full account as full but not over', () => {
    expect(storageMeter(FREE, FREE)).toMatchObject({
      barWidth: '100.0',
      percentage: '100.0',
      isOverLimit: false,
    });
  });

  it('keeps drawing at full while still counting past it', () => {
    // What a cancelled Pro subscription looks like: 3 GB of files against a
    // 500 MB plan. "100.0%" would read as "just full" and say nothing about
    // why every upload is now refused.
    const meter = storageMeter(3 * 1024 * 1024 * 1024, FREE);

    expect(meter.barWidth).toBe('100.0');
    expect(meter.percentage).toBe('614.4');
    expect(meter.isOverLimit).toBe(true);
  });

  it('does not divide by a limit of zero', () => {
    const meter = storageMeter(1_000, 0);

    expect(meter.percentage).toBe('0.0');
    expect(meter.barWidth).toBe('0.0');
    expect(meter.isOverLimit).toBe(true);
  });

  it('ignores a usage figure that never arrived', () => {
    // getTotalStorageUsed() returning undefined once put "NaN%" on the page.
    expect(storageMeter(NaN, FREE).percentage).toBe('0.0');
    expect(storageMeter(undefined as unknown as number, FREE).percentage).toBe('0.0');
  });
});
