import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import OfflineQueueBanner from './OfflineQueueBanner';
import type { PendingOp, QueuedMutation } from '../services/mutation-queue';

function show(pending: number, discarded: QueuedMutation[] = []) {
  const onRetry = vi.fn();
  render(<OfflineQueueBanner pending={pending} discarded={discarded} onRetry={onRetry} />);
  return { onRetry };
}

const gaveUp = (op: PendingOp, lastError: string): QueuedMutation => ({
  id: 'q1',
  op,
  createdAt: 0,
  attempts: 3,
  lastError,
});

describe('OfflineQueueBanner', () => {
  it('stays out of the way when nothing is waiting', () => {
    show(0);
    expect(screen.queryByTestId('offline-queue')).not.toBeInTheDocument();
  });

  it('counts one change in the singular', () => {
    show(1);
    expect(screen.getByText(/1 change waiting/)).toBeInTheDocument();
  });

  it('counts several in the plural', () => {
    show(3);
    expect(screen.getByText(/3 changes waiting/)).toBeInTheDocument();
  });

  it('says what happens next, rather than only what went wrong', () => {
    // Nothing is broken and nothing was lost; the wording has to say so.
    show(2);
    expect(screen.getByText(/sent when it comes back/)).toBeInTheDocument();
  });

  it('offers to try again now', () => {
    // The browser fires its online event when the interface returns, which is
    // not the same as the server being reachable.
    const { onRetry } = show(1);
    fireEvent.click(screen.getByText('Try now'));

    expect(onRetry).toHaveBeenCalled();
  });
});

describe('OfflineQueueBanner: changes that did not go through', () => {
  it('says what was lost instead of disappearing', () => {
    // The banner used to vanish whether everything had been sent or the last
    // three attempts had failed — so a change the user watched apply on screen
    // could be discarded without a word.
    show(0, [gaveUp({ kind: 'renameFile', fileId: 'f1', name: 'x' }, 'Invalid name')]);

    expect(screen.getByText(/Renaming a file did not go through/)).toBeInTheDocument();
    expect(screen.getByText(/Invalid name/)).toBeInTheDocument();
  });

  it('counts them when there is more than one', () => {
    show(0, [
      gaveUp({ kind: 'deleteFile', fileId: 'f1' }, 'gone'),
      gaveUp({ kind: 'deleteFolder', folderId: 'd1' }, 'gone'),
    ]);

    expect(screen.getByText(/2 changes did not go through/)).toBeInTheDocument();
  });

  it('goes back to the waiting message while anything is still queued', () => {
    show(1, [gaveUp({ kind: 'deleteFile', fileId: 'f1' }, 'gone')]);
    expect(screen.getByText(/1 change waiting/)).toBeInTheDocument();
  });
});
