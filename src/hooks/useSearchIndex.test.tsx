import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSearchIndex } from './useSearchIndex';
import { withQueryClient } from '../test/utils';

type Outcome = { indexed: number; skipped: number; failed: number };

const { unindexedFileIds, indexMany } = vi.hoisted(() => ({
  unindexedFileIds: vi.fn(),
  indexMany: vi.fn(),
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('../services/ai.service', () => ({ default: { unindexedFileIds, indexMany } }));

function show(enabled = true) {
  const onProblem = vi.fn();
  const { queryClient, wrapper } = withQueryClient();
  const view = renderHook(({ enabled }) => useSearchIndex({ enabled, onProblem }), {
    wrapper,
    initialProps: { enabled },
  });
  return { ...view, onProblem, queryClient };
}

/** Shown, with the two missing files known, and ready to index them. */
async function ready() {
  const shown = show();
  await waitFor(() => expect(shown.result.current.unindexed).toEqual(['f1', 'f2']));
  return shown;
}

async function runWith(outcome: Outcome) {
  indexMany.mockResolvedValue(outcome);
  const shown = await ready();
  await act(() => shown.result.current.indexMissing());
  return shown;
}

beforeEach(() => {
  vi.clearAllMocks();
  unindexedFileIds.mockResolvedValue(['f1', 'f2']);
  indexMany.mockResolvedValue({ indexed: 2, skipped: 0, failed: 0 });
});

describe('useSearchIndex', () => {
  /* Two reads the dashboard need not make on every visit: the answer only
     matters while a search by meaning is on screen. */
  it('asks which files are missing only while a search by meaning is on screen', async () => {
    const { result, rerender } = show(false);
    await act(() => Promise.resolve());
    expect(unindexedFileIds).not.toHaveBeenCalled();

    rerender({ enabled: true });

    await waitFor(() => expect(result.current.unindexed).toEqual(['f1', 'f2']));
    expect(unindexedFileIds).toHaveBeenCalledWith('user-1');
  });

  it('indexes the files that were missing, and no others', async () => {
    await runWith({ indexed: 2, skipped: 0, failed: 0 });

    expect(indexMany).toHaveBeenCalledWith(['f1', 'f2'], expect.any(Function));
  });

  /* Describing twenty files is minutes of a spinner, so the button counts. */
  it('counts a run as it goes, and stops counting when it ends', async () => {
    let progress!: (done: number, total: number) => void;
    let finish!: (outcome: Outcome) => void;
    indexMany.mockImplementation((_ids: string[], onProgress: typeof progress) => {
      progress = onProgress;
      return new Promise<Outcome>((resolve) => (finish = resolve));
    });
    const { result } = await ready();

    let run!: Promise<void>;
    act(() => {
      run = result.current.indexMissing();
    });
    expect(result.current.indexing).toEqual({ done: 0, total: 2 });

    act(() => progress(1, 2));
    expect(result.current.indexing).toEqual({ done: 1, total: 2 });

    await act(async () => {
      finish({ indexed: 2, skipped: 0, failed: 0 });
      await run;
    });
    expect(result.current.indexing).toBeNull();
  });

  it('stops counting when the run fails as well', async () => {
    indexMany.mockRejectedValue(new Error('network down'));
    const { result } = await ready();

    await act(() => expect(result.current.indexMissing()).rejects.toThrow('network down'));

    expect(result.current.indexing).toBeNull();
  });

  /* A run where every file failed, with no key on this deployment say, used
     to end exactly like a run where every file was indexed. */
  describe('what it says when a run is over', () => {
    it('how many failed, and that search will not find them yet', async () => {
      const { onProblem } = await runWith({ indexed: 1, skipped: 0, failed: 1 });

      expect(onProblem).toHaveBeenCalledWith(
        'Indexed 1 of 2. 1 failed — smart search will not find those yet.'
      );
    });

    it('that there was nothing it could read', async () => {
      const { onProblem } = await runWith({ indexed: 0, skipped: 2, failed: 0 });

      expect(onProblem).toHaveBeenCalledWith('Nothing to index: 2 files cannot be read.');
    });

    it('one file, not one files', async () => {
      const { onProblem } = await runWith({ indexed: 0, skipped: 1, failed: 0 });

      expect(onProblem).toHaveBeenCalledWith('Nothing to index: 1 file cannot be read.');
    });

    it('nothing, when every file was indexed or could not be read', async () => {
      const { onProblem } = await runWith({ indexed: 1, skipped: 1, failed: 0 });

      expect(onProblem).not.toHaveBeenCalled();
    });
  });

  it('asks again afterwards, for what is missing and for what matches', async () => {
    indexMany.mockResolvedValue({ indexed: 2, skipped: 0, failed: 0 });
    const { result, queryClient } = await ready();
    const earlierMatches = ['smart-search', 'user-1', 'hotel receipt'];
    queryClient.setQueryData(earlierMatches, []);
    unindexedFileIds.mockResolvedValue([]);

    await act(() => result.current.indexMissing());

    expect(unindexedFileIds).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryState(earlierMatches)?.isInvalidated).toBe(true);
    await waitFor(() => expect(result.current.unindexed).toEqual([]));
  });
});
