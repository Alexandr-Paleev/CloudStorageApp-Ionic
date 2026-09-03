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

  const queueIt = (op: queue.PendingOp) =>
    offline
      .runOrQueue(op, async () => {
        throw new TypeError('Failed to fetch');
      })
      .catch(() => undefined);

  return (
    <div>
      <span data-testid="count">{offline.ops.length}</span>
      <button onClick={() => queueIt({ kind: 'deleteFile', fileId: 'f1' })}>delete</button>
      <button
        onClick={() => queueIt({ kind: 'renameFile', fileId: 'f1', name: '  report .pdf  ' })}
      >
        rename
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

let stored: queue.QueuedMutation[] = [];

beforeEach(async () => {
  vi.restoreAllMocks();
  /* The hook asks before it tries: with the browser reporting no network the
     change is written down without a request being made at all. */
  vi.stubGlobal('navigator', { onLine: false });
  const rows: queue.QueuedMutation[] = [];
  vi.spyOn(queue.mutationStore, 'add').mockImplementation(async (op, userId) => {
    const entry = { id: `q${rows.length}`, op, userId, createdAt: rows.length, attempts: 0 };
    rows.push(entry);
    return entry;
  });
  vi.spyOn(queue.mutationStore, 'list').mockImplementation(async () => rows);
  stored = rows;
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

describe('a name queued offline', () => {
  it('is sanitised before it is written down', async () => {
    // The offline path skips the service that would normally do it, so an
    // impossible name would be shown as saved and then refused three times by
    // the server and thrown away.
    show();
    screen.getByText('rename').click();

    await waitFor(() => expect(stored).toHaveLength(1));
    expect((stored[0].op as { name: string }).name).toBe('report .pdf');
  });

  it('is recorded against the account that made it', async () => {
    show();
    screen.getByText('delete').click();

    await waitFor(() => expect(stored).toHaveLength(1));
    expect(stored[0].userId).toBe('user-1');
  });
});
