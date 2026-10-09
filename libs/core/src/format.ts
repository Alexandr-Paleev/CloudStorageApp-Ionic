/**
 * Byte sizes for humans.
 *
 * This lived in `libs/server` while only the functions used it, to word a
 * refusal: "Using 480.2 MB of 500.0 MB". The plans say the same limits in a
 * sentence, on the site and in the app, so it is here now.
 */

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;

/** A measured size, with the decimals a measurement has: "480.2 MB", "3.00 GB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < KB) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`;
  if (bytes < GB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${(bytes / GB).toFixed(2)} GB`;
}

/**
 * A limit, the way a plan states it: "500 MB", "5 GB".
 *
 * A limit is a round number somebody chose, and "500.0 MB" reads like a
 * reading off a meter. One that is not round keeps a decimal, so that
 * 1.5 GB is not sold as 2.
 */
export function formatStorage(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';

  for (const [unit, size] of [
    ['GB', GB],
    ['MB', MB],
    ['KB', KB],
  ] as const) {
    if (bytes >= size) {
      const value = bytes / size;
      return `${Number.isInteger(value) ? value : value.toFixed(1)} ${unit}`;
    }
  }

  return `${bytes} B`;
}
