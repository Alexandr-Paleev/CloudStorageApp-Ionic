import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useFileListing } from './useFileListing';
import type { FileFiltersValue } from '../components/FileFilters';
import type { PendingOp } from '../services/mutation-queue';
import { DEFAULT_DIRECTION, DEFAULT_SORT } from '../utils/file-query';
import { withQueryClient } from '../test/utils';

const { getItems, smartSearch, deployment, queue } = vi.hoisted(() => ({
  getItems: vi.fn(),
  smartSearch: vi.fn(),
  deployment: { offersSmartSearch: true },
  queue: { ops: [] as PendingOp[] },
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('../services/storage.service', () => ({ default: { getItems } }));
vi.mock('../services/ai.service', () => ({ default: { smartSearch } }));
vi.mock('../utils/smart-search.utils', () => ({
  smartSearchIsOffered: () => deployment.offersSmartSearch,
}));
vi.mock('./useOfflineQueue', () => ({
  useOfflineQueue: () => ({ ops: queue.ops }),
}));

const BY_NAME: FileFiltersValue = {
  search: '',
  sort: DEFAULT_SORT,
  direction: DEFAULT_DIRECTION,
  group: 'all',
  mode: 'name',
};

const BY_MEANING: FileFiltersValue = { ...BY_NAME, mode: 'smart', search: 'hotel receipt' };

const file = (id: string, name = `${id}.pdf`) => ({ id, name, size: 1, type: 'application/pdf' });
const files = (count: number, from = 0) =>
  Array.from({ length: count }, (_, i) => file(`f${from + i}`));

function show(folderId: string | undefined, filters: FileFiltersValue) {
  const { queryClient, wrapper } = withQueryClient();
  const view = renderHook(({ filters }) => useFileListing(folderId, filters), {
    wrapper,
    initialProps: { filters },
  });
  return { ...view, queryClient };
}

beforeEach(() => {
  vi.clearAllMocks();
  queue.ops = [];
  deployment.offersSmartSearch = true;
  getItems.mockResolvedValue({ files: [], folders: [] });
  smartSearch.mockResolvedValue({ files: [], model: 'voyage-4' });
});

describe('useFileListing', () => {
  describe('the ordinary list', () => {
    it('asks for the folder it is in, fifteen at a time, under the filters', async () => {
      show('folder-9', { ...BY_NAME, sort: 'size', group: 'images' });

      await waitFor(() => expect(getItems).toHaveBeenCalledTimes(1));
      expect(getItems).toHaveBeenCalledWith('user-1', {
        ...BY_NAME,
        sort: 'size',
        group: 'images',
        folderId: 'folder-9',
        page: 0,
        pageSize: 15,
      });
    });

    it('asks for the root when it is not in a folder', async () => {
      show(undefined, BY_NAME);

      await waitFor(() => expect(getItems).toHaveBeenCalledTimes(1));
      expect(getItems.mock.calls[0]![1]).toMatchObject({ folderId: null });
    });

    /* The filters are part of the question, so they are part of the key: a
       new filter asks again rather than showing what the last one returned. */
    it('asks again when a filter changes', async () => {
      const { rerender } = show(undefined, BY_NAME);
      await waitFor(() => expect(getItems).toHaveBeenCalledTimes(1));

      rerender({ filters: { ...BY_NAME, sort: 'name', direction: 'asc' } });

      await waitFor(() => expect(getItems).toHaveBeenCalledTimes(2));
      expect(getItems.mock.calls[1]![1]).toMatchObject({ sort: 'name', direction: 'asc' });
    });

    it('offers the next page only after a full one', async () => {
      getItems
        .mockResolvedValueOnce({ files: files(15), folders: [] })
        .mockResolvedValueOnce({ files: files(3, 15), folders: [] });
      const { result } = show(undefined, BY_NAME);

      await waitFor(() => expect(result.current.hasNextPage).toBe(true));
      await act(() => result.current.fetchNextPage());

      expect(getItems.mock.calls[1]![1]).toMatchObject({ page: 1 });
      await waitFor(() => expect(result.current.hasNextPage).toBe(false));
      expect(result.current.items.files).toHaveLength(18);
    });

    it('lists the folders beside the files', async () => {
      getItems.mockResolvedValue({ files: [file('f1')], folders: [{ id: 'd1', name: 'Work' }] });
      const { result } = show(undefined, BY_NAME);

      await waitFor(() =>
        expect(result.current.items.folders).toEqual([{ id: 'd1', name: 'Work' }])
      );
      expect(result.current.items.files).toEqual([file('f1')]);
    });
  });

  /* The cache stays what the server said. What this device has queued and not
     yet sent is laid over it each time, so the screen agrees with a change
     that has not left the device. */
  it('lays the changes waiting in the queue over the server’s answer', async () => {
    getItems.mockResolvedValue({
      files: [file('f1'), file('f2')],
      folders: [
        { id: 'd1', name: 'Work' },
        { id: 'd2', name: 'Old' },
      ],
    });
    queue.ops = [
      { kind: 'deleteFile', fileId: 'f2' },
      { kind: 'renameFolder', folderId: 'd1', name: 'Archive' },
      { kind: 'deleteFolder', folderId: 'd2' },
    ];
    const { result } = show(undefined, BY_NAME);

    await waitFor(() => expect(result.current.items.files).toEqual([file('f1')]));
    expect(result.current.items.folders).toEqual([{ id: 'd1', name: 'Archive' }]);
  });

  describe('searching by meaning', () => {
    it('asks the index instead of the file names', async () => {
      smartSearch.mockResolvedValue({
        files: [{ ...file('s1', 'hotel.pdf'), summary: 'A hotel bill' }],
        model: 'voyage-4',
      });
      const { result } = show(undefined, BY_MEANING);

      await waitFor(() => expect(result.current.items.files).toHaveLength(1));
      expect(smartSearch).toHaveBeenCalledWith('hotel receipt');
      expect(result.current.smartSearching).toBe(true);
      expect(result.current.items.folders).toEqual([]);
      // Not asked at all: the two lists answer different questions.
      expect(getItems).not.toHaveBeenCalled();
    });

    /* Otherwise a file deleted offline comes back from the database as a
       perfectly good match. */
    it('keeps a file deleted offline out of the matches', async () => {
      smartSearch.mockResolvedValue({ files: [file('s1'), file('s2')], model: 'voyage-4' });
      queue.ops = [{ kind: 'deleteFile', fileId: 's1' }];
      const { result } = show(undefined, BY_MEANING);

      await waitFor(() => expect(result.current.items.files).toEqual([file('s2')]));
    });

    /* For the count of files not indexed yet, which has to ask about the
       same model: a row another one made is a file this search cannot
       return. */
    it('says which model the matches were found with, and none for the list', async () => {
      const { result, rerender } = show(undefined, BY_MEANING);
      await waitFor(() => expect(result.current.smartModel).toBe('voyage-4'));

      // The same words, asked of the names: the matches are still cached.
      rerender({ filters: { ...BY_MEANING, mode: 'name' } });

      await waitFor(() => expect(getItems).toHaveBeenCalledTimes(1));
      expect(result.current.smartModel).toBeUndefined();
    });

    it('reports the search’s failure and its loading, not the list’s', async () => {
      let fail!: (error: Error) => void;
      smartSearch.mockReturnValue(new Promise((_, reject) => (fail = reject)));
      const { result } = show(undefined, BY_MEANING);

      await waitFor(() => expect(result.current.loading).toBe(true));
      act(() => fail(new Error('Smart search is not set up')));

      await waitFor(() => expect(result.current.error?.message).toBe('Smart search is not set up'));
      expect(result.current.loading).toBe(false);
    });

    it('is the ordinary list where this deployment does not offer it', async () => {
      deployment.offersSmartSearch = false;
      const { result } = show(undefined, BY_MEANING);

      await waitFor(() => expect(getItems).toHaveBeenCalledTimes(1));
      expect(smartSearch).not.toHaveBeenCalled();
      expect(result.current.smartSearching).toBe(false);
      expect(result.current.searching).toBe(true);
    });

    it('is the ordinary list while there is nothing to search for', async () => {
      const { result } = show(undefined, { ...BY_MEANING, search: '   ' });

      await waitFor(() => expect(getItems).toHaveBeenCalledTimes(1));
      expect(smartSearch).not.toHaveBeenCalled();
      expect(result.current.searching).toBe(false);
    });
  });

  it('marks every listing of this account stale when asked to refresh', async () => {
    const { result, queryClient } = show(undefined, BY_NAME);
    const elsewhere = ['items', 'user-1', 'folder-9', BY_NAME];
    queryClient.setQueryData(elsewhere, { pages: [], pageParams: [] });
    await waitFor(() => expect(getItems).toHaveBeenCalledTimes(1));

    await act(() => result.current.refresh());

    expect(queryClient.getQueryState(elsewhere)?.isInvalidated).toBe(true);
    // And the one on screen is asked again.
    expect(getItems).toHaveBeenCalledTimes(2);
  });
});
