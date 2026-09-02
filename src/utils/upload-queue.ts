/**
 * Several files, uploaded one after another.
 *
 * The state lives here, apart from React, because the interesting parts are
 * not rendering: what happens to the rest of the queue when one file fails,
 * what "progress" means across files of wildly different sizes, and what the
 * same file dropped twice should do. Those are answerable in a test that never
 * mounts anything.
 */

export type QueueStatus = 'pending' | 'uploading' | 'done' | 'failed' | 'paused';

export interface QueueItem {
  /** Stable across renders, and the same for the same file picked twice. */
  id: string;
  file: File;
  status: QueueStatus;
  /** Percent of this file, not of the queue. */
  progress: number;
  error?: string;
}

/**
 * What makes two picks the same file.
 *
 * Name alone is not enough — two folders can hold different files with the
 * same name — and the File object itself is no good either: the picker hands
 * back a new one every time, so identity would never match.
 */
export function identify(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

/**
 * Adds files, skipping the ones already queued.
 *
 * Dropping the same selection twice is easy to do and never intended, and an
 * upload of the same bytes twice costs the quota twice.
 */
export function enqueue(items: QueueItem[], files: File[]): QueueItem[] {
  const known = new Set(items.map((item) => item.id));
  const added: QueueItem[] = [];

  for (const file of files) {
    const id = identify(file);
    if (known.has(id)) continue;
    known.add(id);
    added.push({ id, file, status: 'pending', progress: 0 });
  }

  return [...items, ...added];
}

export function update(items: QueueItem[], id: string, patch: Partial<QueueItem>): QueueItem[] {
  return items.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

export function remove(items: QueueItem[], id: string): QueueItem[] {
  return items.filter((item) => item.id !== id);
}

/**
 * Folds in files added while the queue was already running.
 *
 * The runner walks a local copy — React state updates do not land in the
 * middle of a loop — so anything picked during an upload would otherwise be
 * invisible until the queue stopped and started again.
 */
export function absorb(local: QueueItem[], latest: QueueItem[]): QueueItem[] {
  const known = new Set(local.map((item) => item.id));
  return [...local, ...latest.filter((item) => !known.has(item.id))];
}

/** The next file to send: paused ones wait for the person, not for the queue. */
export function nextPending(items: QueueItem[]): QueueItem | undefined {
  return items.find((item) => item.status === 'pending');
}

/**
 * How far the whole queue is, weighted by size.
 *
 * Counting files would jump from 0% to 50% when a thumbnail finishes and then
 * sit still through the video behind it. Bytes are what the person is waiting
 * for.
 */
export function overallProgress(items: QueueItem[]): number {
  const total = items.reduce((sum, item) => sum + item.file.size, 0);
  if (total === 0) return 0;

  const done = items.reduce((sum, item) => {
    if (item.status === 'done') return sum + item.file.size;
    return sum + (item.file.size * item.progress) / 100;
  }, 0);

  return Math.min(100, (done / total) * 100);
}

export interface QueueSummary {
  total: number;
  done: number;
  failed: number;
  pending: number;
  /** Nothing left to do, whether or not everything worked. */
  finished: boolean;
}

export function summarise(items: QueueItem[]): QueueSummary {
  const count = (status: QueueStatus) => items.filter((item) => item.status === status).length;

  const done = count('done');
  const failed = count('failed');

  return {
    total: items.length,
    done,
    failed,
    pending: count('pending'),
    // A paused file is not finished, and neither is one still going.
    finished: items.length > 0 && done + failed === items.length,
  };
}

/** The sentence shown when the queue stops. Plural-aware, and honest about failures. */
export function summaryText(summary: QueueSummary): string {
  if (summary.total === 0) return '';

  const files = (n: number) => `${n} file${n === 1 ? '' : 's'}`;

  if (summary.failed === 0) return `${files(summary.done)} uploaded`;
  if (summary.done === 0) return `${files(summary.failed)} could not be uploaded`;
  return `${files(summary.done)} uploaded, ${summary.failed} failed`;
}
