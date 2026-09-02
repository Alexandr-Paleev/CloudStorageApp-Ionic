import { describe, it, expect } from 'vitest';
import {
  enqueue,
  identify,
  nextPending,
  overallProgress,
  remove,
  summarise,
  summaryText,
  update,
  type QueueItem,
} from './upload-queue';

function file(name: string, size = 1000, lastModified = 1_700_000_000_000): File {
  const f = new File([new Uint8Array(size)], name, { type: 'application/pdf' });
  Object.defineProperty(f, 'lastModified', { value: lastModified });
  return f;
}

const queued = (...files: File[]) => enqueue([], files);

describe('identify', () => {
  it('is the same for the same file picked twice', () => {
    // The picker hands back a new File object every time, so object identity
    // would never match and every re-pick would look like a new file.
    expect(identify(file('a.pdf'))).toBe(identify(file('a.pdf')));
  });

  it('tells apart two files that only share a name', () => {
    expect(identify(file('a.pdf', 1000))).not.toBe(identify(file('a.pdf', 2000)));
  });

  it('tells apart the same name and size edited at different times', () => {
    expect(identify(file('a.pdf', 1000, 1))).not.toBe(identify(file('a.pdf', 1000, 2)));
  });
});

describe('enqueue', () => {
  it('adds every file as pending', () => {
    const items = queued(file('a.pdf'), file('b.pdf'));

    expect(items).toHaveLength(2);
    expect(items.every((i) => i.status === 'pending' && i.progress === 0)).toBe(true);
  });

  it('keeps the order they were picked in', () => {
    const items = queued(file('a.pdf'), file('b.pdf'), file('c.pdf'));
    expect(items.map((i) => i.file.name)).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);
  });

  it('ignores a file already in the queue', () => {
    // Dropping the same selection twice is easy and never intended — and it
    // would spend the quota twice.
    const items = enqueue(queued(file('a.pdf')), [file('a.pdf'), file('b.pdf')]);

    expect(items.map((i) => i.file.name)).toEqual(['a.pdf', 'b.pdf']);
  });

  it('ignores a duplicate inside one selection', () => {
    expect(queued(file('a.pdf'), file('a.pdf'))).toHaveLength(1);
  });

  it('re-queues a file that already finished, since that was on purpose', () => {
    // Somebody picking the same file again after it uploaded is asking for it
    // again — but the queue is a record of this session, so it stays skipped
    // until they clear it. Documented rather than silently either way.
    const done = update(queued(file('a.pdf')), identify(file('a.pdf')), { status: 'done' });
    expect(enqueue(done, [file('a.pdf')])).toHaveLength(1);
  });
});

describe('nextPending', () => {
  it('takes them in order', () => {
    const items = queued(file('a.pdf'), file('b.pdf'));
    expect(nextPending(items)?.file.name).toBe('a.pdf');
  });

  it('skips what is already going, done or failed', () => {
    let items = queued(file('a.pdf'), file('b.pdf'), file('c.pdf'));
    items = update(items, items[0].id, { status: 'done' });
    items = update(items, items[1].id, { status: 'failed' });

    expect(nextPending(items)?.file.name).toBe('c.pdf');
  });

  it('leaves a paused file alone', () => {
    // Pausing is a decision; the queue must not walk past it and start the
    // next file as if nothing happened.
    let items = queued(file('a.pdf'));
    items = update(items, items[0].id, { status: 'paused' });

    expect(nextPending(items)).toBeUndefined();
  });
});

describe('overallProgress', () => {
  it('weights by bytes, not by file count', () => {
    // Counting files would jump to 50% when the thumbnail lands and then sit
    // still through the video behind it.
    let items = queued(file('small.pdf', 100), file('large.pdf', 900));
    items = update(items, items[0].id, { status: 'done' });

    expect(overallProgress(items)).toBe(10);
  });

  it('counts a file in flight by how far it has got', () => {
    let items = queued(file('a.pdf', 1000));
    items = update(items, items[0].id, { status: 'uploading', progress: 40 });

    expect(overallProgress(items)).toBe(40);
  });

  it('is zero for an empty queue rather than not-a-number', () => {
    expect(overallProgress([])).toBe(0);
  });

  it('never exceeds a hundred', () => {
    let items = queued(file('a.pdf', 1000));
    items = update(items, items[0].id, { status: 'done', progress: 140 });

    expect(overallProgress(items)).toBe(100);
  });
});

describe('summarise', () => {
  const three = () => queued(file('a.pdf'), file('b.pdf'), file('c.pdf'));

  it('is not finished while anything is still pending', () => {
    let items = three();
    items = update(items, items[0].id, { status: 'done' });

    expect(summarise(items).finished).toBe(false);
  });

  it('is finished when everything has either landed or failed', () => {
    let items = three();
    items = items.map((i) => ({ ...i, status: 'done' as const }));
    items = update(items, items[2].id, { status: 'failed' });

    const summary = summarise(items);
    expect(summary).toMatchObject({ done: 2, failed: 1, finished: true });
  });

  it('is not finished while one is paused', () => {
    let items = three();
    items = items.map((i) => ({ ...i, status: 'done' as const }));
    items = update(items, items[0].id, { status: 'paused' });

    expect(summarise(items).finished).toBe(false);
  });

  it('says nothing about an empty queue', () => {
    expect(summarise([]).finished).toBe(false);
  });
});

describe('summaryText', () => {
  it.each([
    [{ total: 1, done: 1, failed: 0, pending: 0, finished: true }, '1 file uploaded'],
    [{ total: 3, done: 3, failed: 0, pending: 0, finished: true }, '3 files uploaded'],
    [{ total: 2, done: 0, failed: 2, pending: 0, finished: true }, '2 files could not be uploaded'],
    [{ total: 3, done: 2, failed: 1, pending: 0, finished: true }, '2 files uploaded, 1 failed'],
    [{ total: 0, done: 0, failed: 0, pending: 0, finished: false }, ''],
  ])('%o -> %s', (summary, expected) => {
    expect(summaryText(summary)).toBe(expected);
  });
});

describe('remove', () => {
  it('takes one file out and leaves the rest in order', () => {
    const items: QueueItem[] = queued(file('a.pdf'), file('b.pdf'), file('c.pdf'));
    expect(remove(items, items[1].id).map((i) => i.file.name)).toEqual(['a.pdf', 'c.pdf']);
  });
});
