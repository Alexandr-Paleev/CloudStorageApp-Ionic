import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import UploadQueue from './UploadQueue';
import { enqueue, update, type QueueItem, type QueueStatus } from '../utils/upload-queue';

function file(name: string, size = 2048): File {
  return new File([new Uint8Array(size)], name, { type: 'application/pdf' });
}

function queue(...entries: [string, QueueStatus, number?][]): QueueItem[] {
  let items = enqueue(
    [],
    entries.map(([name]) => file(name))
  );
  entries.forEach(([, status, progress], index) => {
    items = update(items, items[index].id, { status, progress: progress ?? 0 });
  });
  return items;
}

function show(items: QueueItem[], running = false) {
  const onRemove = vi.fn();
  const onRetry = vi.fn();
  render(<UploadQueue items={items} running={running} onRemove={onRemove} onRetry={onRetry} />);
  return { onRemove, onRetry };
}

describe('UploadQueue', () => {
  it('shows nothing when nothing is queued', () => {
    show([]);
    expect(screen.queryByTestId('upload-queue')).not.toBeInTheDocument();
  });

  it('lists every file, whatever its state', () => {
    // A single bar would hide the one that failed: "9 uploaded" and the tenth
    // is a mystery until the dashboard comes up short.
    show(queue(['a.pdf', 'done'], ['b.pdf', 'uploading', 40], ['c.pdf', 'failed']));

    for (const name of ['a.pdf', 'b.pdf', 'c.pdf']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it('keeps file names out of session recordings', () => {
    show(queue(['secret-contract.pdf', 'pending']));
    expect(screen.getByText('secret-contract.pdf')).toHaveAttribute('data-hj-suppress');
  });

  it('says why a file failed, rather than only that it did', () => {
    let items = queue(['a.pdf', 'failed']);
    items = update(items, items[0].id, { error: 'Storage limit exceeded' });
    show(items);

    expect(screen.getByText(/Storage limit exceeded/)).toBeInTheDocument();
  });

  it('shows progress only for the file actually going', () => {
    show(queue(['a.pdf', 'uploading', 42], ['b.pdf', 'pending']));

    expect(screen.getByText(/42%/)).toBeInTheDocument();
    expect(document.querySelectorAll('ion-progress-bar')).toHaveLength(1);
  });

  it('lets a queued file be taken out before the run starts', () => {
    const { onRemove } = show(queue(['a.pdf', 'pending']));
    fireEvent.click(screen.getByLabelText('Remove a.pdf'));

    expect(onRemove).toHaveBeenCalled();
  });

  it('does not offer to remove a file once the queue is running', () => {
    // Removing the row would leave the upload itself running, for a file
    // nobody can see any more.
    show(queue(['a.pdf', 'pending']), true);
    expect(screen.queryByLabelText('Remove a.pdf')).not.toBeInTheDocument();
  });

  it('does not offer to remove a file that already went', () => {
    show(queue(['a.pdf', 'done']));
    expect(screen.queryByLabelText('Remove a.pdf')).not.toBeInTheDocument();
  });

  it('offers to resume a paused file', () => {
    const { onRetry } = show(queue(['a.pdf', 'paused']));
    fireEvent.click(screen.getByText('Resume'));

    expect(onRetry).toHaveBeenCalled();
  });
});
