import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import {
  coalesce,
  flushQueue,
  withDeadline,
  looksOffline,
  mutationStore,
  type FlushResult,
  type PendingOp,
} from '../services/mutation-queue';

/** One key, so every component showing the queue is showing the same one. */
const OFFLINE_QUEUE_KEY = ['offlineQueue'] as const;

/**
 * Changes made offline, and the moment they are sent.
 *
 * The queue itself is in services/mutation-queue.ts; this is the part that
 * knows about React: how many are waiting, what to do when the browser says
 * the network is back, and how to make the screen agree with a change that has
 * not left the device yet.
 */
function useOfflineQueueState() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [lastResult, setLastResult] = useState<FlushResult | null>(null);

  /* The queue is read through TanStack rather than kept in React state.
     Everything else in this app already shares state through that cache, and
     it is shared by construction: one entry, every component reading it, and
     an invalidation that reaches all of them. Component-local state did not
     survive the trip — the mutation runs in one instance of this hook and the
     list is rendered from another. */
  const { data: queued = [] } = useQuery({
    queryKey: OFFLINE_QUEUE_KEY,
    queryFn: () => mutationStore.list(),
    /* Without this the query is paused exactly when it matters: TanStack holds
       queries while the browser reports no network, and IndexedDB does not
       need one. */
    networkMode: 'always',
    staleTime: 0,
  });

  const ops = useMemo(() => coalesce(queued).map((entry) => entry.op), [queued]);

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: OFFLINE_QUEUE_KEY }),
    [queryClient]
  );

  /** Runs one queued change for real. */
  const perform = useCallback(
    async (op: PendingOp) => {
      if (!user?.id) throw new Error('User not authenticated');

      /* Imported here rather than at the top of the file: this provider sits
         in App.tsx, and a static import would pull the whole storage layer —
         every provider, the SDKs behind them — into the first chunk the
         browser downloads, for code that only runs when a queued change is
         finally sent. The bundle budget caught it. */
      const { default: storageService } = await import('../services/storage.service');

      switch (op.kind) {
        case 'renameFile':
          return storageService.renameFile(op.fileId, user.id, op.name);
        case 'deleteFile':
          return storageService.deleteFile(op.fileId, user.id);
        case 'renameFolder':
          await storageService.renameFolder(op.folderId, user.id, op.name);
          return;
        case 'deleteFolder':
          return storageService.deleteFolder(op.folderId, user.id);
      }
    },
    [user?.id]
  );

  const flush = useCallback(async () => {
    const result = await flushQueue(perform);
    await refresh();
    setLastResult(result);

    if (result.sent > 0 || result.failed > 0) {
      queryClient.invalidateQueries({ queryKey: ['items', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['storageSize', user?.id] });
    }

    return result;
  }, [perform, refresh, queryClient, user?.id]);

  /**
   * Does the thing, or writes it down if the network is not there.
   *
   * The distinction is made by the failure, not by navigator.onLine alone: a
   * browser can be online and still unable to reach this particular host, and
   * that is exactly the case where a lost rename is most annoying.
   */
  const runOrQueue = useCallback(
    /* The trailing comma is load-bearing in a .tsx file: without it the
       parser reads <T> as the start of a JSX element. */
    async <T,>(op: PendingOp, action: () => Promise<T>): Promise<{ queued: boolean }> => {
      /* Asked before trying, because a request made with no network does not
         reliably fail: it can hang on a token refresh that will never happen,
         and a change waiting inside a promise nobody watches is exactly what
         this queue exists to prevent. */
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        await mutationStore.add(op);
        await refresh();
        return { queued: true };
      }

      try {
        await withDeadline(action());
        return { queued: false };
      } catch (error) {
        if (!looksOffline(error)) throw error;

        await mutationStore.add(op);
        await refresh();
        return { queued: true };
      }
    },
    [refresh]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    /* The browser's own signal, which fires when the interface comes back —
       not proof the server is reachable, which is why flushQueue stops again
       at the first failure that looks like no network. */
    const onOnline = () => void flush();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [flush]);

  return { ops, pending: ops.length, flush, runOrQueue, lastResult };
}

export type OfflineQueue = ReturnType<typeof useOfflineQueueState>;

const OfflineQueueContext = createContext<OfflineQueue | null>(null);

/**
 * One queue for the whole app.
 *
 * It was per-page state until a test showed why that cannot work: the delete
 * button on the dashboard runs inside one instance of the hook, and with Ionic
 * keeping pages mounted (and React's StrictMode mounting them twice in
 * development) the instance that queues the change is not always the instance
 * that renders the list. The queue is one thing — it belongs above the pages.
 */
export const OfflineQueueProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const value = useOfflineQueueState();
  return <OfflineQueueContext.Provider value={value}>{children}</OfflineQueueContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export function useOfflineQueue(): OfflineQueue {
  const context = useContext(OfflineQueueContext);
  if (!context) throw new Error('useOfflineQueue must be used inside OfflineQueueProvider');
  return context;
}
