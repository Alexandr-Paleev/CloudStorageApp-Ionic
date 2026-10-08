import { describe, it, expect, beforeEach, vi } from 'vitest';
import aiService from './ai.service';
import { HttpError } from '../utils/http.utils';
import { EMBEDDING_DIMENSIONS } from '../../libs/core/src/ai';

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

/** `.select().eq()` settles on whatever this table was given. */
const table = (answer: { data?: unknown[]; error?: unknown }) => ({
  select: () => ({ eq: () => Promise.resolve({ error: null, ...answer }) }),
});

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
    await expect(aiService.smartSearch('   ')).resolves.toEqual([]);
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
  it('returns the files the index has never seen', async () => {
    from.mockImplementation((name: string) =>
      name === 'files'
        ? table({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] })
        : table({ data: [{ file_id: 'b' }] })
    );

    await expect(aiService.unindexedFileIds('user-1')).resolves.toEqual(['a', 'c']);
  });
});
