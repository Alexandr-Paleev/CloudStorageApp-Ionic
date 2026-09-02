import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import OfflineQueueBanner from './OfflineQueueBanner';

function show(pending: number) {
  const onRetry = vi.fn();
  render(<OfflineQueueBanner pending={pending} onRetry={onRetry} />);
  return { onRetry };
}

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
