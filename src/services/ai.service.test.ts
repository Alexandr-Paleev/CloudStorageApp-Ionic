import { describe, it, expect, beforeEach, vi } from 'vitest';
import aiService, { readLines, type AnswerEvent } from './ai.service';
import { HttpError } from '../utils/http.utils';
import { EMBEDDING_DIMENSIONS } from '@cloud-storage/core/ai';
import * as Sentry from '../observability/sentry';

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

/** A table that answers `.select().eq().order().range()` with its rows,
 *  filtered, ordered and cut as asked, and with how many matched — thenable,
 *  as the Supabase builder is. `maxRows` is PostgREST's cap on one answer,
 *  whatever range was asked for. */
const table = (rows: Record<string, unknown>[], { maxRows = 1000 } = {}) => {
  const query = (kept: Record<string, unknown>[], window?: [number, number]) => ({
    eq: (column: string, value: unknown) =>
      query(
        kept.filter((row) => row[column] === value),
        window
      ),
    order: (column: string) =>
      query(
        [...kept].sort((a, b) => String(a[column]).localeCompare(String(b[column]))),
        window
      ),
    range: (from: number, to: number) => query(kept, [from, to]),
    then: (settle: (answer: { data: unknown[]; error: null; count: number }) => void) => {
      const [from, to] = window ?? [0, kept.length - 1];
      settle({
        data: kept.slice(from, Math.min(to + 1, from + maxRows)),
        error: null,
        count: kept.length,
      });
    },
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

  it('asks with the floor of the model that made the vector', async () => {
    await aiService.smartSearch('hotel invoice');
    expect((rpc.mock.calls[0] as [string, Record<string, unknown>])[1].min_similarity).toBe(0.25);

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ embedding: VECTOR, model: '@cf/baai/bge-m3' }),
    });
    await aiService.smartSearch('hotel invoice');
    expect((rpc.mock.calls[1] as [string, Record<string, unknown>])[1].min_similarity).toBe(0.4);
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

    expect(result).toEqual({
      indexed: 1,
      skipped: 1,
      failed: 1,
      // The reason travels, for the dashboard to list it rather than offer the file again.
      skips: [{ fileId: 'c', reason: 'nothing to read' }],
    });
    // Sequential on purpose: a folder of photographs sent at once is how an
    // account gets throttled by the provider.
    expect(progress).toEqual([1, 2, 3]);
  });

  /* A 429 says the day's budget, or the minute's, is spent, and every file
     after this one would be told the same: a request each to hear it, and a
     report each in Sentry. */
  it('stops at a refusal to go on, and says what the route said', async () => {
    const said = 'You have indexed as many files today as a day allows.';
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ indexed: true }) })
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ message: said }) });

    const result = await aiService.indexMany(['a', 'b', 'c']);

    expect(result).toEqual({ indexed: 1, skipped: 0, failed: 0, skips: [], stopped: said });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});

describe('unindexedFiles', () => {
  const files = table(['a', 'b', 'c'].map((id) => ({ id, name: `${id}.pdf`, user_id: 'user-1' })));
  /** Which files came back, by id: what most of these tests are about. */
  const unindexedIds = (userId: string, model: string) =>
    aiService.unindexedFiles(userId, model).then((rows) => rows.map((row) => row.id));
  /** A file's first piece, which is what makes it indexed (ADR 0019). */
  const row = (file_id: string, embedding_model: string, chunk_index = 0) => ({
    file_id,
    user_id: 'user-1',
    embedding_model,
    chunk_index,
  });

  it('returns the files the index has never seen', async () => {
    from.mockImplementation((name: string) =>
      name === 'files' ? files : table([row('b', 'voyage-4')])
    );

    await expect(unindexedIds('user-1', 'voyage-4')).resolves.toEqual(['a', 'c']);
  });

  it('names each file, for the dashboard to list', async () => {
    from.mockImplementation((name: string) =>
      name === 'files' ? files : table([row('b', 'voyage-4')])
    );

    await expect(aiService.unindexedFiles('user-1', 'voyage-4')).resolves.toEqual([
      { id: 'a', name: 'a.pdf', user_id: 'user-1' },
      { id: 'c', name: 'c.pdf', user_id: 'user-1' },
    ]);
  });

  it('reads the pieces, so a file described before they existed is offered again', async () => {
    const read: string[] = [];
    from.mockImplementation((name: string) => {
      read.push(name);
      return name === 'files' ? files : table([row('b', 'voyage-4')]);
    });

    await unindexedIds('user-1', 'voyage-4');

    expect(read.sort()).toEqual(['file_chunks', 'files']);
  });

  it('counts a file once, by its first piece', async () => {
    from.mockImplementation((name: string) =>
      name === 'files'
        ? files
        : table([row('b', 'voyage-4', 0), row('b', 'voyage-4', 1), row('c', 'voyage-4', 3)])
    );

    await expect(unindexedIds('user-1', 'voyage-4')).resolves.toEqual(['a', 'c']);
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

    await expect(unindexedIds('user-1', 'voyage-4')).resolves.toEqual(['a', 'c']);
  });

  /* One answer used to be taken as all there was, and PostgREST stops at a
     thousand rows: past that, indexed files read as missing and were offered
     again, each a paid request at a model provider. */
  describe('past a thousand files', () => {
    const id = (n: number) => `file-${String(n).padStart(5, '0')}`;
    const many = (count: number) =>
      Array.from({ length: count }, (_, n) => ({ id: id(n), user_id: 'user-1' }));
    const indexedUpTo = (count: number) =>
      Array.from({ length: count }, (_, n) => row(id(n), 'voyage-4'));

    it('compares every file with every row of the index', async () => {
      from.mockImplementation((name: string) =>
        name === 'files' ? table(many(1500)) : table(indexedUpTo(1400))
      );

      const missing = await unindexedIds('user-1', 'voyage-4');

      expect(missing).toHaveLength(100);
      expect(missing[0]).toBe(id(1400));
    });

    it('reads through a project whose cap on one answer is lower than asked for', async () => {
      from.mockImplementation((name: string) =>
        name === 'files'
          ? table(many(1200), { maxRows: 500 })
          : table(indexedUpTo(1100), { maxRows: 500 })
      );

      await expect(unindexedIds('user-1', 'voyage-4')).resolves.toHaveLength(100);
    });

    it('asks each table once for an account of a few files', async () => {
      from.mockImplementation((name: string) =>
        name === 'files' ? table(many(30)) : table(indexedUpTo(10))
      );

      await unindexedIds('user-1', 'voyage-4');

      expect(from.mock.calls.map(([name]) => name).sort()).toEqual(['file_chunks', 'files']);
    });
  });
});

/** A body that arrives in the chunks given, as a network delivers it. */
const streamOf = (chunks: (string | Uint8Array)[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks)
        controller.enqueue(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
      controller.close();
    },
  });

describe('indexModel', () => {
  it('asks the route, with the session, which model the index is made with', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ model: 'bge' }) });

    await expect(aiService.indexModel()).resolves.toBe('bge');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/ai\/model$/);
    expect(init.headers).toMatchObject({ Authorization: 'Bearer jwt' });
  });
});

describe('readLines', () => {
  it('reads a line split across chunks, and a character split across them', async () => {
    const line = new TextEncoder().encode('{"type":"text","text":"евро"}\n');
    const cut = line.indexOf(0xd0, 25) + 1; // inside the two bytes of a Cyrillic letter
    const events: AnswerEvent[] = [];

    for await (const event of readLines(
      streamOf([
        '{"type":"so',
        'urces","model":"m","sources":[]}\n',
        line.slice(0, cut),
        line.slice(cut),
        '{"type":"done"}',
      ])
    ))
      events.push(event);

    expect(events).toEqual([
      { type: 'sources', model: 'm', sources: [] },
      { type: 'text', text: 'евро' },
      { type: 'done' },
    ]);
  });
});

describe('ask', () => {
  it('hands each line on as it comes', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: streamOf(['{"type":"text","text":"950 euros [1]."}\n{"type":"done"}\n']),
    });
    const events: AnswerEvent[] = [];

    await aiService.ask('Rent?', (event) => events.push(event));

    expect(events).toEqual([{ type: 'text', text: '950 euros [1].' }, { type: 'done' }]);
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({
      question: 'Rent?',
    });
  });

  it('throws a refusal before the answer, with when to come back', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({
        message: 'You have asked as many questions today as a day allows.',
        retryAt: new Date(Date.now() + 5 * 3600_000).toISOString(),
      }),
    });

    const error = await aiService.ask('Rent?', () => {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(429);
    expect((error as HttpError).message).toMatch(/You can try again (tomorrow )?after/);
  });

  it('passes the signal on, so that Stop ends the request', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, body: streamOf([]) });
    const stop = new AbortController();

    await aiService.ask('Rent?', () => {}, stop.signal);

    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].signal).toBe(stop.signal);
  });
});
