import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSearchIndex } from './useSearchIndex';
import { withQueryClient } from '../test/utils';
import { skipsKey } from '../utils/index-skips';

type Outcome = {
  indexed: number;
  skipped: number;
  failed: number;
  skips: { fileId: string; reason: string }[];
  stopped?: string;
};

const { indexModel, unindexedFiles, indexMany } = vi.hoisted(() => ({
  indexModel: vi.fn(),
  unindexedFiles: vi.fn(),
  indexMany: vi.fn(),
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('../services/ai.service', () => ({
  default: { indexModel, unindexedFiles, indexMany },
}));

const F1 = { id: 'f1', name: 'lease.pdf' };
const F2 = { id: 'f2', name: 'backup.zip' };

function show(enabled = true) {
  const onProblem = vi.fn();
  const onNotice = vi.fn();
  const { queryClient, wrapper } = withQueryClient();
  const view = renderHook(
    ({ enabled }: { enabled: boolean }) => useSearchIndex({ enabled, onProblem, onNotice }),
    { wrapper, initialProps: { enabled } }
  );
  return { ...view, onProblem, onNotice, queryClient };
}

/** Shown, with the two missing files known, and ready to index them. */
async function ready() {
  const shown = show();
  await waitFor(() => expect(shown.result.current.pending).toEqual([F1, F2]));
  return shown;
}

async function runWith(outcome: Outcome) {
  indexMany.mockResolvedValue(outcome);
  const shown = await ready();
  await act(() => shown.result.current.indexMissing());
  return shown;
}

const NOTHING_SKIPPED = { skips: [] };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  indexModel.mockResolvedValue('@cf/baai/bge-m3');
  unindexedFiles.mockResolvedValue([F1, F2]);
  indexMany.mockResolvedValue({ indexed: 2, skipped: 0, failed: 0, ...NOTHING_SKIPPED });
});

describe('useSearchIndex', () => {
  /* "Index them" used to wait for a search by meaning, the only place the
     browser learned the model; the server now says it, at no cost. */
  it('asks the server for the model, then which files that model is missing', async () => {
    const { result } = show();

    await waitFor(() => expect(result.current.pending).toEqual([F1, F2]));
    expect(unindexedFiles).toHaveBeenCalledWith('user-1', '@cf/baai/bge-m3');
  });

  it('asks nothing where the account may not index', async () => {
    show(false);
    await act(() => Promise.resolve());

    expect(indexModel).not.toHaveBeenCalled();
    expect(unindexedFiles).not.toHaveBeenCalled();
  });

  it('indexes the files that were missing, and no others', async () => {
    await runWith({ indexed: 2, skipped: 0, failed: 0, ...NOTHING_SKIPPED });

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
      finish({ indexed: 2, skipped: 0, failed: 0, ...NOTHING_SKIPPED });
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

  /* A ZIP stays a ZIP: offered on every visit, it was the "1 not indexed"
     that pressing "Index them" never made go away. */
  describe('a file it cannot read', () => {
    const SKIPPED: Outcome = {
      indexed: 1,
      skipped: 1,
      failed: 0,
      skips: [{ fileId: 'f2', reason: 'archives are not indexed' }],
    };

    /** A run that indexes f1 and skips f2, after which only f2 is missing. */
    const runSkipping = async () => {
      const shown = await ready();
      indexMany.mockImplementation(async () => {
        unindexedFiles.mockResolvedValue([F2]);
        return SKIPPED;
      });
      await act(() => shown.result.current.indexMissing());
      return shown;
    };

    it('moves to its own list, with the reason, and is not offered again', async () => {
      const { result } = await runSkipping();

      await waitFor(() => expect(result.current.pending).toEqual([]));
      expect(result.current.unreadable).toEqual([{ ...F2, reason: 'archives are not indexed' }]);
    });

    it('is remembered in this browser, per account and model', async () => {
      await runWith(SKIPPED);

      expect(JSON.parse(localStorage.getItem(skipsKey('user-1', '@cf/baai/bge-m3'))!)).toEqual({
        f2: 'archives are not indexed',
      });
    });

    it('is read back on the next visit', async () => {
      localStorage.setItem(
        skipsKey('user-1', '@cf/baai/bge-m3'),
        JSON.stringify({ f2: 'archives are not indexed' })
      );
      const { result } = show();

      await waitFor(() => expect(result.current.pending).toEqual([F1]));
      expect(result.current.unreadable).toEqual([{ ...F2, reason: 'archives are not indexed' }]);
    });

    it('belongs to the model: another model is offered it again', async () => {
      localStorage.setItem(skipsKey('user-1', 'voyage-4'), JSON.stringify({ f2: 'too large' }));
      const { result } = show();

      await waitFor(() => expect(result.current.pending).toEqual([F1, F2]));
      expect(result.current.unreadable).toEqual([]);
    });

    it('can be offered once more, since a reason can go away', async () => {
      const { result } = await runSkipping();
      await waitFor(() => expect(result.current.unreadable).toHaveLength(1));

      act(() => result.current.retryUnreadable());

      expect(result.current.pending).toEqual([F2]);
      expect(localStorage.getItem(skipsKey('user-1', '@cf/baai/bge-m3'))).toBeNull();
    });

    it('works without storage, offering the file again rather than failing', async () => {
      const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      const { result } = await runSkipping();

      // Listed for this visit all the same; only the next one forgets it.
      await waitFor(() => expect(result.current.unreadable).toHaveLength(1));
      setItem.mockRestore();
    });
  });

  /* A run where every file failed, with no key on this deployment say, used
     to end exactly like a run where every file was indexed. */
  describe('what it says when a run is over', () => {
    it('how many failed, and that search will not find them yet', async () => {
      const { onProblem } = await runWith({ indexed: 1, skipped: 0, failed: 1, skips: [] });

      expect(onProblem).toHaveBeenCalledWith(
        'Indexed 1 of 2. 1 failed — smart search will not find those yet.'
      );
    });

    /* Not red: nothing went wrong, and the list says which and why. */
    it('that there was nothing it could read, as news rather than a fault', async () => {
      const { onProblem, onNotice } = await runWith({
        indexed: 0,
        skipped: 2,
        failed: 0,
        skips: [
          { fileId: 'f1', reason: 'no text' },
          { fileId: 'f2', reason: 'archives are not indexed' },
        ],
      });

      expect(onNotice).toHaveBeenCalledWith(
        'Nothing could be indexed: 2 files cannot be read. The list says why.'
      );
      expect(onProblem).not.toHaveBeenCalled();
    });

    it('one file, not one files', async () => {
      const { onNotice } = await runWith({
        indexed: 1,
        skipped: 1,
        failed: 0,
        skips: [{ fileId: 'f2', reason: 'archives are not indexed' }],
      });

      expect(onNotice).toHaveBeenCalledWith(
        'Indexed 1 of 2. 1 file cannot be read. The list says why.'
      );
    });

    it('what the route said when it stopped the run', async () => {
      const { onProblem } = await runWith({
        indexed: 1,
        skipped: 0,
        failed: 0,
        skips: [],
        stopped: 'This site has indexed as many files today as it allows in a day.',
      });

      expect(onProblem).toHaveBeenCalledWith(
        'Indexed 1 of 2. This site has indexed as many files today as it allows in a day.'
      );
    });

    it('nothing, when every file was indexed', async () => {
      const { onProblem, onNotice } = await runWith({
        indexed: 2,
        skipped: 0,
        failed: 0,
        skips: [],
      });

      expect(onProblem).not.toHaveBeenCalled();
      expect(onNotice).not.toHaveBeenCalled();
    });
  });

  it('asks again afterwards, for what is missing and for what matches', async () => {
    const { result, queryClient } = await ready();
    const earlierMatches = ['smart-search', 'user-1', 'hotel receipt'];
    queryClient.setQueryData(earlierMatches, []);
    unindexedFiles.mockResolvedValue([]);

    await act(() => result.current.indexMissing());

    expect(unindexedFiles).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryState(earlierMatches)?.isInvalidated).toBe(true);
    await waitFor(() => expect(result.current.pending).toEqual([]));
  });
});
