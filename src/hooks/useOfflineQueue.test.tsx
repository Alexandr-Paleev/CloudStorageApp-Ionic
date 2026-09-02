import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OfflineQueueProvider, useOfflineQueue } from './useOfflineQueue';
import * as queue from '../services/mutation-queue';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('../services/storage.service', () => ({ default: {} }));

/** A component that both queues and displays — the two halves that have to agree. */
function Probe() {
  const offline = useOfflineQueue();

  return (
    <div>
      <span data-testid="count">{offline.ops.length}</span>
      <button
        onClick={() =>
          offline
            .runOrQueue({ kind: 'deleteFile', fileId: 'f1' }, async () => {
              throw new TypeError('Failed to fetch');
            })
            .catch(() => undefined)
        }
      >
        delete
      </button>
    </div>
  );
}

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OfflineQueueProvider>
        <Probe />
      </OfflineQueueProvider>
    </QueryClientProvider>
  );
}

beforeEach(async () => {
  vi.restoreAllMocks();
  /* The hook asks before it tries: with the browser reporting no network the
     change is written down without a request being made at all. */
  vi.stubGlobal('navigator', { onLine: false });
  const rows: queue.QueuedMutation[] = [];
  vi.spyOn(queue.mutationStore, 'add').mockImplementation(async (op) => {
    const entry = { id: `q${rows.length}`, op, createdAt: rows.length, attempts: 0 };
    rows.push(entry);
    return entry;
  });
  vi.spyOn(queue.mutationStore, 'list').mockImplementation(async () => rows);
  vi.spyOn(queue.mutationStore, 'remove').mockResolvedValue(undefined);
});

describe('the offline queue, as a component sees it', () => {
  it('starts empty', async () => {
    show();
    expect(screen.getByTestId('count')).toHaveTextContent('0');
  });

  it('shows a change queued by the same component', async () => {
    // The part that was broken: the mutation ran in one instance of the hook
    // and the list was rendered from another, so the screen never moved.
    show();
    screen.getByText('delete').click();

    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));
  });
});
