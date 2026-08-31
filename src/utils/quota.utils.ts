/** The storage meter as the dashboard draws it. */
export type StorageMeter = {
  /** Fraction of the plan in use. Not clamped — it can exceed 1. */
  ratio: number;
  /** Width of the bar, in percent. Clamped: a bar cannot draw past full. */
  barWidth: string;
  /** The figure next to the bar, in percent. Deliberately not clamped. */
  percentage: string;
  isOverLimit: boolean;
};

/**
 * The bar stops at full, the number does not.
 *
 * Cancelling Pro drops the limit from 5 GB back to 500 MB without deleting
 * anything, so an account can sit well past its plan. Rounding that down to
 * "100.0%" would hide how far past — which is also the reason uploads have
 * started failing, and the first thing the user needs to be told.
 */
export function storageMeter(usedBytes: number, storageLimit: number): StorageMeter {
  const used = Number.isFinite(usedBytes) && usedBytes > 0 ? usedBytes : 0;

  // A limit that is zero, negative or unreadable is not a plan with room in
  // it: nothing fits, so the meter reads full rather than empty. Guarding only
  // the division — as this did at first — left the two halves disagreeing: the
  // dashboard printed a red "0.0%" beside "500 MB over the limit" while the
  // upgrade banner, reading the same ratio, stayed hidden below its threshold.
  // `!(limit > 0)` rather than `limit <= 0` so NaN lands here too.
  if (!(storageLimit > 0)) {
    return { ratio: 1, barWidth: '100.0', percentage: '100.0', isOverLimit: used > 0 };
  }

  const ratio = used / storageLimit;

  return {
    ratio,
    barWidth: (Math.min(ratio, 1) * 100).toFixed(1),
    percentage: (ratio * 100).toFixed(1),
    isOverLimit: used > storageLimit,
  };
}
