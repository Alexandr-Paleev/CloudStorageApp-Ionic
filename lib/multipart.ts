/**
 * How a large upload is cut into parts.
 *
 * Shared by both sides on purpose: the browser slices the file with these
 * numbers and the handler signs part URLs against them, so a disagreement here
 * would mean a completed upload whose parts do not reassemble into the file.
 * One module, imported by src/ and by api/, is the cheapest way to make that
 * impossible.
 */

/** Below this, a single PUT is simpler and finishes in one round trip.
 *  16 MiB is roughly where a flaky connection starts losing whole uploads. */
export const MULTIPART_THRESHOLD = 16 * 1024 * 1024;

/** S3 and R2 refuse a part under 5 MiB unless it is the last one. 8 gives the
 *  floor some room and keeps the part count low on ordinary files. */
export const MIN_PART_SIZE = 8 * 1024 * 1024;

/** The protocol allows 10 000. This is lower on purpose: every part is a signed
 *  URL that has to be fetched, tracked and re-signed on resume, and 1 000 parts
 *  already covers 8 GB before the part size has to grow at all. */
export const MAX_PARTS = 1000;

/** Part URLs are signed in batches rather than one request per part. */
export const MAX_PARTS_PER_BATCH = 100;

export interface PartPlan {
  /** Bytes per part — every part but the last is exactly this. R2 rejects a
   *  completion where an inner part differs. */
  partSize: number;
  partCount: number;
}

/**
 * Chooses a part size for a file.
 *
 * Grows the part rather than the count once a file is large enough that
 * MAX_PARTS would be exceeded, and rounds up to a whole MiB so the arithmetic
 * on both sides stays exact.
 */
export function planParts(size: number): PartPlan {
  if (size <= 0) return { partSize: MIN_PART_SIZE, partCount: 0 };

  const MiB = 1024 * 1024;
  const needed = Math.ceil(size / MAX_PARTS);
  const partSize = Math.max(MIN_PART_SIZE, Math.ceil(needed / MiB) * MiB);

  return { partSize, partCount: Math.ceil(size / partSize) };
}

/** The byte range of one part, 1-indexed the way S3 numbers them. */
export function partRange(
  partNumber: number,
  plan: PartPlan,
  size: number
): { start: number; end: number } {
  const start = (partNumber - 1) * plan.partSize;
  return { start, end: Math.min(start + plan.partSize, size) };
}

/** Whether a file should go up in parts at all. */
export function shouldUseMultipart(size: number): boolean {
  return size >= MULTIPART_THRESHOLD;
}
