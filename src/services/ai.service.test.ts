import { describe, it, expect, beforeEach, vi } from 'vitest';
import aiService from './ai.service';
import { HttpError } from '../utils/http.utils';
import { EMBEDDING_DIMENSIONS } from '@cloud-storage/core/ai';

const getSession = vi.fn();
const rpc = vi.fn();
const from = vi.fn();

vi.mock('../supabase/supabase.config', () => ({
  supabase: {
    auth: { getSession: () => getSession() },
    rpc: (...args: unknown[]) => rpc(...args),
    from: (table: string) => from(table),
  },
}));

vi.mock('../observability/sentry', () => ({ captureException: vi.fn() }));

const fetchMock = vi.fn();
const VECTOR = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.5);

/** A table that answers `.select().eq()…` with its rows, filtered as asked —
 *  thenable, as the Supabase builder is. */
const table = (rows: Record<string, unknown>[]) => {
  const query = (kept: Record<string, unknown>[]) => ({
    eq: (column: string, value: unknown) => query(kept.filter((row) => row[column] === value)),
    then: (settle: (answer: { data: unknown[]; error: null }) => void) =>
      settle({ data: kept, error: null }),
  });
  return { select: () => query(rows) };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  getSession.mockResolvedValue({ data: { session: { access_token: 'jwt' } } });
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ embedding: VECTOR, model: 'voyage-4' }),
  });
  rpc.mockResolvedValue({ data: [], error: null });
});

describe('smartSearch', () => {
  it('asks nobody anything when the box is empty', async () => {
    await expect(aiService.smartSearch('   ')).resolves.toEqual({ files: [] });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('passes the model that made the vector, not one of its own', async () => {
    // match_files compares only rows made by the same model. If the browser
    // decided the name, a provider swap on the server would rank nonsense.
    await aiService.smartSearch('hotel invoice');

    const [fn, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(fn).toBe('match_files');
    expect(args.model_name).toBe('voyage-4');
    expect(args.query_embedding).toBe(JSON.stringify(VECTOR));
  });

  it('says which model the matches were found with', async () => {
    // The count of files not indexed yet has to ask about the same model:
    // a row another one made is a file this search cannot return.
    rpc.mockResolvedValue({ data: [{ id: 'f1', summary: 'A hotel bill' }], error: null });

    await expect(aiService.smartSearch('hotel')).resolves.toEqual({
      files: [{ id: 'f1', summary: 'A hotel bill' }],
      model: 'voyage-4',
    });
  });

  it('keeps the status when the route refuses, so nothing retries a 501', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 501,
      json: async () => ({ message: 'No AI provider is configured' }),
    });

    await expect(aiService.smartSearch('hotel')).rejects.toMatchObject({
      name: 'HttpError',
      status: 501,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('names the migration when the function is not in the database', async () => {
    // PostgREST says PGRST202 and nothing about which file creates it.
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'not found' } });

    await expect(aiService.smartSearch('hotel')).rejects.toThrow(/migrations\/011/);
  });
});

describe('indexFile', () => {
  it('reports a skip as an answer rather than as a failure', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ indexed: false, reason: 'demo accounts are not indexed' }),
    });

    await expect(aiService.indexFile('file-1')).resolves.toMatchObject({ indexed: false });
  });

  it('throws with the route’s own message when it refuses', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ message: 'That file is not stored where your files are' }),
    });

    await expect(aiService.indexFile('file-1')).rejects.toBeInstanceOf(HttpError);
  });
});

describe('indexMany', () => {
  it('counts each outcome and does not stop at the first failure', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ indexed: true }) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ message: 'boom' }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ indexed: false, reason: 'nothing to read' }),
      });

    const progress: number[] = [];
    const result = await aiService.indexMany(['a', 'b', 'c'], (done) => progress.push(done));

    expect(result).toEqual({ indexed: 1, skipped: 1, failed: 1 });
    // Sequential on purpose: a folder of photographs sent at once is how an
    // account gets throttled by the provider.
    expect(progress).toEqual([1, 2, 3]);
  });
});

describe('unindexedFileIds', () => {
  const files = table(['a', 'b', 'c'].map((id) => ({ id, user_id: 'user-1' })));
  const row = (file_id: string, embedding_model: string) => ({
    file_id,
    user_id: 'user-1',
    embedding_model,
  });

  it('returns the files the index has never seen', async () => {
    from.mockImplementation((name: string) =>
      name === 'files' ? files : table([row('b', 'voyage-4')])
    );

    await expect(aiService.unindexedFileIds('user-1', 'voyage-4')).resolves.toEqual(['a', 'c']);
  });

  /* After the server changes backend, match_files compares only rows of the
     new model, so a file indexed by the old one is a file the search cannot
     return. Counted as indexed, it would never be offered again. */
  it('counts a file indexed by another model as missing', async () => {
    from.mockImplementation((name: string) =>
      name === 'files'
        ? files
        : table([row('a', '@cf/baai/bge-large-en-v1.5'), row('b', 'voyage-4')])
    );

    await expect(aiService.unindexedFileIds('user-1', 'voyage-4')).resolves.toEqual(['a', 'c']);
  });
});
