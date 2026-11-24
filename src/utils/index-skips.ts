/**
 * The files the index route would not take, and why, as this browser saw it.
 *
 * A convenience, not a record: storage can be cleared, blocked or absent (a
 * private window), and then a file is only offered for indexing once more,
 * which the route answers with the same reason. So every read and write
 * gives up quietly. Keyed by account and model, because the reason belongs to
 * the model: a picture too large for the free one is not for the paid one.
 */

export const skipsKey = (userId: string, model: string) =>
  `cloud-storage.index-skips.${userId}.${model}`;

export function readSkips(key: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    );
  } catch {
    return {};
  }
}

export function writeSkips(key: string, reasons: Record<string, string>): void {
  try {
    if (Object.keys(reasons).length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(reasons));
  } catch {
    // Not kept: the files are offered once more, and skipped again.
  }
}
