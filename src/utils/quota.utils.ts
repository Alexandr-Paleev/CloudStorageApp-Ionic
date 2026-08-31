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
  const ratio = storageLimit > 0 ? used / storageLimit : 0;

  return {
    ratio,
    barWidth: (Math.min(ratio, 1) * 100).toFixed(1),
    percentage: (ratio * 100).toFixed(1),
    isOverLimit: used > storageLimit,
  };
}
