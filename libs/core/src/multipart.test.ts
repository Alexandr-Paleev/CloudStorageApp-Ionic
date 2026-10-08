import { describe, it, expect } from 'vitest';
import {
  MAX_PARTS,
  MIN_PART_SIZE,
  MULTIPART_THRESHOLD,
  partRange,
  planParts,
  shouldUseMultipart,
} from './multipart';

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

describe('shouldUseMultipart', () => {
  it.each([
    [1, false],
    [MULTIPART_THRESHOLD - 1, false],
    [MULTIPART_THRESHOLD, true],
    [5 * GiB, true],
  ])('%d bytes -> %s', (size, expected) => {
    expect(shouldUseMultipart(size)).toBe(expected);
  });
});

describe('planParts', () => {
  it('uses the minimum part size while the count stays reasonable', () => {
    expect(planParts(100 * MiB)).toEqual({ partSize: MIN_PART_SIZE, partCount: 13 });
  });

  it('grows the part rather than the count on a very large file', () => {
    const plan = planParts(100 * GiB);
    expect(plan.partCount).toBeLessThanOrEqual(MAX_PARTS);
    expect(plan.partSize).toBeGreaterThan(MIN_PART_SIZE);
  });

  it('keeps the part size a whole number of MiB', () => {
    // Both sides slice on these numbers. A fractional part size is a rounding
    // difference waiting to produce an object that is one byte short.
    expect(planParts(37 * GiB).partSize % MiB).toBe(0);
  });

  it('never plans more parts than the protocol allows', () => {
    for (const size of [1 * GiB, 50 * GiB, 500 * GiB, 5000 * GiB]) {
      expect(planParts(size).partCount).toBeLessThanOrEqual(MAX_PARTS);
    }
  });

  it('covers the file exactly, with no gap and no overlap', () => {
    for (const size of [MULTIPART_THRESHOLD, 100 * MiB, 3 * GiB, 17 * GiB + 12345]) {
      const plan = planParts(size);
      let covered = 0;
      let previousEnd = 0;

      for (let n = 1; n <= plan.partCount; n++) {
        const { start, end } = partRange(n, plan, size);
        expect(start).toBe(previousEnd);
        covered += end - start;
        previousEnd = end;
      }

      expect(covered).toBe(size);
      expect(previousEnd).toBe(size);
    }
  });

  it('makes every part but the last exactly one part size', () => {
    // R2 rejects a completion where an inner part is a different size.
    const size = 100 * MiB;
    const plan = planParts(size);

    for (let n = 1; n < plan.partCount; n++) {
      const { start, end } = partRange(n, plan, size);
      expect(end - start).toBe(plan.partSize);
    }

    const last = partRange(plan.partCount, plan, size);
    expect(last.end - last.start).toBeLessThanOrEqual(plan.partSize);
  });

  it('treats an empty file as nothing to send', () => {
    expect(planParts(0).partCount).toBe(0);
  });
});
