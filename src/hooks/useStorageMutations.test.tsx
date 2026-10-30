import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { useStorageMutations } from './useStorageMutations';
import type { Folder } from '../services/storage.service';
import { withQueryClient } from '../test/utils';

const { storage, runOrQueue } = vi.hoisted(() => ({
  storage: {
    renameFolder: vi.fn(),
    deleteFolder: vi.fn(),
    deleteFile: vi.fn(),
    createFolder: vi.fn(),
  },
  runOrQueue: vi.fn(),
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('../services/storage.service', () => ({ default: storage }));

/* The queue itself is tested in useOfflineQueue.test.tsx. What matters here
   is which changes are handed to it, and how. */
vi.mock('./useOfflineQueue', () => ({
  useOfflineQueue: () => ({ runOrQueue }),
}));

const WORK = { id: 'work', name: 'Work', parent_id: null, user_id: 'user-1' } as Folder;

function show(folderId?: string) {
  const onProblem = vi.fn();
  const { queryClient, wrapper } = withQueryClient();
  const { result } = renderHook(() => useStorageMutations({ folderId, onProblem }), { wrapper });
  return { result, onProblem, queryClient };
}

beforeEach(() => {
  vi.clearAllMocks();
  runOrQueue.mockImplementation((_op: unknown, run: () => Promise<unknown>) => run());
  storage.renameFolder.mockResolvedValue({ ...WORK, name: 'Archive' });
  storage.deleteFolder.mockResolvedValue(undefined);
  storage.deleteFile.mockResolvedValue(undefined);
  storage.createFolder.mockResolvedValue({ id: 'new', name: 'Invoices' });
});

afterEach(() => {
  onlineManager.setOnline(true);
});

describe('useStorageMutations', () => {
  describe('the three changes that can wait for the network', () => {
    it('renames a folder through the queue', async () => {
      const { result } = show();

      act(() => result.current.renameFolder.mutate({ folder: WORK, name: 'Archive' }));

      await waitFor(() => expect(result.current.renameFolder.isSuccess).toBe(true));
      expect(runOrQueue).toHaveBeenCalledWith(
        { kind: 'renameFolder', folderId: 'work', name: 'Archive' },
        expect.any(Function)
      );
      expect(storage.renameFolder).toHaveBeenCalledWith('work', 'user-1', 'Archive');
    });

    /* A deadline cannot cancel what it gives up on. Deleting a folder walks
       its whole tree, one request per file, and can outlast any deadline
       worth setting: timed out, it would be queued while still running and
       replayed later against a half-deleted tree. */
    it('deletes a folder through the queue, with no deadline', async () => {
      const { result } = show();

      act(() => result.current.deleteFolder.mutate(WORK));

      await waitFor(() => expect(result.current.deleteFolder.isSuccess).toBe(true));
      expect(runOrQueue).toHaveBeenCalledWith(
        { kind: 'deleteFolder', folderId: 'work' },
        expect.any(Function),
        { deadline: null }
      );
      expect(storage.deleteFolder).toHaveBeenCalledWith('work', 'user-1');
    });

    it('deletes a file through the queue, under the usual deadline', async () => {
      const { result } = show();

      act(() => result.current.deleteFile.mutate('f1'));

      await waitFor(() => expect(result.current.deleteFile.isSuccess).toBe(true));
      // Two arguments and no third: the deadline is left to the queue.
      expect(runOrQueue).toHaveBeenCalledWith(
        { kind: 'deleteFile', fileId: 'f1' },
        expect.any(Function)
      );
      expect(storage.deleteFile).toHaveBeenCalledWith('f1', 'user-1');
    });

    /* TanStack holds a mutation while the browser reports no network, and by
       default it never calls the mutation's function at all: the change would
       live in this tab's memory until a reload lost it. The queue can only
       write a change down if the attempt is made. */
    it('tries each of them while the browser says it is offline', async () => {
      const { result } = show();
      onlineManager.setOnline(false);

      act(() => {
        result.current.renameFolder.mutate({ folder: WORK, name: 'Archive' });
        result.current.deleteFolder.mutate(WORK);
        result.current.deleteFile.mutate('f1');
      });

      await waitFor(() => expect(runOrQueue).toHaveBeenCalledTimes(3));
      expect(runOrQueue.mock.calls.map(([op]) => op.kind)).toEqual([
        'renameFolder',
        'deleteFolder',
        'deleteFile',
      ]);
    });

    /* The control for the test above: it shows that test is offline at all.
       A new folder has no queue, so it is left to wait for the network. */
    it('leaves a new folder waiting for the network while offline', async () => {
      const { result } = show();
      onlineManager.setOnline(false);

      act(() => result.current.createFolder.mutate('Invoices'));

      await waitFor(() => expect(result.current.createFolder.isPaused).toBe(true));
      expect(storage.createFolder).not.toHaveBeenCalled();
    });
  });

  describe('a new folder', () => {
    it('is made inside the folder the dashboard is in', async () => {
      const { result } = show('folder-9');

      act(() => result.current.createFolder.mutate('Invoices'));

      await waitFor(() => expect(result.current.createFolder.isSuccess).toBe(true));
      expect(storage.createFolder).toHaveBeenCalledWith('user-1', 'Invoices', 'folder-9');
      expect(runOrQueue).not.toHaveBeenCalled();
    });

    it('is made at the root when the dashboard is there', async () => {
      const { result } = show();

      act(() => result.current.createFolder.mutate('Invoices'));

      await waitFor(() => expect(result.current.createFolder.isSuccess).toBe(true));
      expect(storage.createFolder).toHaveBeenCalledWith('user-1', 'Invoices', null);
    });
  });

  /* Read back from the cache rather than from a spy on invalidateQueries:
     what matters is which of the entries the page reads go stale, whatever
     key a change happens to invalidate them by. */
  describe('what each change makes stale', () => {
    const FILTERS = {
      search: '',
      sort: 'created_at',
      direction: 'desc',
      group: 'all',
      mode: 'name',
    };

    function seed(queryClient: ReturnType<typeof show>['queryClient']) {
      const entries = {
        thisListing: ['items', 'user-1', 'root', FILTERS],
        anotherFoldersListing: ['items', 'user-1', 'folder-9', FILTERS],
        meter: ['storageSize', 'user-1'],
        breadcrumbs: ['folderPath', 'user-1', 'work'],
        smartSearch: ['smart-search', 'user-1', 'invoice'],
      };
      for (const key of Object.values(entries)) queryClient.setQueryData(key, {});
      return () =>
        Object.fromEntries(
          Object.entries(entries).map(([name, key]) => [
            name,
            queryClient.getQueryState(key)?.isInvalidated,
          ])
        );
    }

    it('a rename: every listing and every breadcrumb bar, and not the meter', async () => {
      const { result, queryClient } = show();
      const stale = seed(queryClient);

      act(() => result.current.renameFolder.mutate({ folder: WORK, name: 'Archive' }));

      await waitFor(() => expect(result.current.renameFolder.isSuccess).toBe(true));
      expect(stale()).toEqual({
        thisListing: true,
        anotherFoldersListing: true,
        meter: false,
        breadcrumbs: true,
        smartSearch: false,
      });
    });

    /* The folder renamed is a card on this page, not the folder this page is
       in. Its name is read from this entry on its own page, as the title. The
       rename used to mark this page's entry instead, and the renamed folder
       opened under its old name, below breadcrumbs that had the new one. */
    it('a rename: the renamed folder’s own name, which its page shows as the title', async () => {
      const { result, queryClient } = show('folder-9');
      queryClient.setQueryData(['folder', 'work'], WORK);

      act(() => result.current.renameFolder.mutate({ folder: WORK, name: 'Archive' }));

      await waitFor(() => expect(result.current.renameFolder.isSuccess).toBe(true));
      expect(queryClient.getQueryState(['folder', 'work'])?.isInvalidated).toBe(true);
    });

    // Deleting a folder deletes its files, so the meter moves too.
    it('a deleted folder: every listing, and the meter', async () => {
      const { result, queryClient } = show();
      const stale = seed(queryClient);

      act(() => result.current.deleteFolder.mutate(WORK));

      await waitFor(() => expect(result.current.deleteFolder.isSuccess).toBe(true));
      expect(stale()).toMatchObject({
        thisListing: true,
        anotherFoldersListing: true,
        meter: true,
        smartSearch: true,
      });
    });

    /* And the answer to a search by meaning, which is kept for a minute: the
       deleted file stayed in it for that long, leading nowhere. */
    it('a deleted file: every listing, the meter, and a search by meaning', async () => {
      const { result, queryClient } = show();
      const stale = seed(queryClient);

      act(() => result.current.deleteFile.mutate('f1'));

      await waitFor(() => expect(result.current.deleteFile.isSuccess).toBe(true));
      expect(stale()).toMatchObject({
        thisListing: true,
        anotherFoldersListing: true,
        meter: true,
        smartSearch: true,
      });
    });

    it('a new folder: the listings, and not the meter', async () => {
      const { result, queryClient } = show();
      const stale = seed(queryClient);

      act(() => result.current.createFolder.mutate('Invoices'));

      await waitFor(() => expect(result.current.createFolder.isSuccess).toBe(true));
      expect(stale()).toMatchObject({ thisListing: true, meter: false });
    });
  });

  describe('when a change cannot be made', () => {
    it('says why a folder was not renamed', async () => {
      storage.renameFolder.mockRejectedValue(new Error('A folder with that name already exists'));
      const { result, onProblem } = show();

      act(() => result.current.renameFolder.mutate({ folder: WORK, name: 'Archive' }));

      await waitFor(() =>
        expect(onProblem).toHaveBeenCalledWith('A folder with that name already exists')
      );
    });

    it('says why a folder was not deleted', async () => {
      storage.deleteFolder.mockRejectedValue(new Error('Folder not found'));
      const { result, onProblem } = show();

      act(() => result.current.deleteFolder.mutate(WORK));

      await waitFor(() => expect(onProblem).toHaveBeenCalledWith('Folder not found'));
    });

    it('says why a folder was not made, and says something when the error does not', async () => {
      storage.createFolder.mockRejectedValue(new Error(''));
      const { result, onProblem } = show();

      act(() => result.current.createFolder.mutate('Invoices'));

      await waitFor(() =>
        expect(onProblem).toHaveBeenCalledWith(
          'Failed to create folder. Ensure Supabase is configured.'
        )
      );
    });

    /* The page shows its own "Failed to delete file" from `isError`. Telling
       it here as well would put two toasts on screen for one failure. */
    it('leaves a file that was not deleted to the page', async () => {
      storage.deleteFile.mockRejectedValue(new Error('File not found or access denied'));
      const { result, onProblem } = show();

      act(() => result.current.deleteFile.mutate('f1'));

      await waitFor(() => expect(result.current.deleteFile.isError).toBe(true));
      expect(onProblem).not.toHaveBeenCalled();
    });
  });
});
