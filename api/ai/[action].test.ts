import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  mockRequest,
  mockResponse,
  mockSupabase,
  type TableAnswer,
} from '../../libs/server/src/test-utils';
import { AI_INDEX_LIMIT, resetRateLimits } from '../../libs/server/src/rate-limit';
import { AI_DAILY_LIMITS } from '../../libs/server/src/ai-budget';
import {
  CHUNK_OVERLAP,
  CHUNK_SIZE,
  EMBEDDING_MODEL,
  MAX_PIECES_PER_FILE,
  ProviderNotConfigured,
  TEXT_SAMPLE_BYTES,
} from '../../libs/core/src/ai';
import { chunkText } from '../../libs/core/src/chunks';

const {
  FakeAuthError,
  authenticate,
  db,
  describeFile,
  embed,
  embedMany,
  supports,
  readsPdf,
  maxImageBytes,
  cloudflareReady,
  pdfText,
  activeBackend,
  createSignedUrl,
  presign,
  rpc,
  callerRpc,
  answer,
  report,
} = vi.hoisted(() => ({
  FakeAuthError: class FakeAuthError extends Error {},
  authenticate: vi.fn(),
  db: {
    client: null as { from: (table: string) => unknown } | null,
    calls: [] as { table: string; op: string; args?: unknown[] }[],
  },
  describeFile: vi.fn(),
  embed: vi.fn(),
  embedMany: vi.fn(),
  supports: vi.fn(),
  readsPdf: { value: true },
  maxImageBytes: { value: undefined as number | undefined },
  cloudflareReady: vi.fn(),
  pdfText: vi.fn(),
  activeBackend: vi.fn(),
  createSignedUrl: vi.fn(),
  presign: vi.fn(),
  rpc: vi.fn(),
  callerRpc: vi.fn(),
  answer: vi.fn(),
  report: vi.fn(),
}));

vi.mock('../../libs/server/src/auth', () => ({
  AuthError: FakeAuthError,
  authenticate: (...args: unknown[]) => authenticate(...args),
  supabase: {
    from: (table: string) => db.client!.from(table),
    // The day's budget, from migrations/017 (libs/server/src/ai-budget.ts).
    rpc: (...args: unknown[]) => rpc(...args),
    storage: {
      from: () => ({ createSignedUrl: (...args: unknown[]) => createSignedUrl(...args) }),
    },
  },
  // The database as the caller sees it, for match_chunks (migration 022).
  supabaseAsCaller: () => ({ rpc: (...args: unknown[]) => callerRpc(...args) }),
}));

// The backend is the seam between this route and whichever pair of models the
// deployment is configured for; the route's job is to pick one and use it.
vi.mock('../../libs/server/src/ai-provider', () => ({
  activeBackend: () => activeBackend(),
}));

// Whether the deployment has a Cloudflare account to read a PDF's text with,
// and what toMarkdown says a PDF holds (libs/server/src/to-markdown.ts).
vi.mock('../../libs/server/src/cloudflare-ai', () => ({
  isConfigured: () => cloudflareReady(),
}));
vi.mock('../../libs/server/src/to-markdown', () => ({
  pdfText: (...args: unknown[]) => pdfText(...args),
}));

// The S3 client wants credentials at construction, and none of this test is
// about signing — only about which URL reaches the model.
vi.mock('../../libs/server/src/r2', () => ({
  getS3Client: () => ({}),
  getR2BucketName: () => 'test-bucket',
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => presign(...args),
}));

vi.mock('../../libs/server/src/report', () => ({
  report: (...args: unknown[]) => report(...args),
}));

import handler from './[action]';

const VECTOR = Array.from({ length: 1024 }, (_, i) => i / 1024);

const FILE = {
  id: 'file-1',
  name: 'photo.jpg',
  type: 'image/jpeg',
  size: 2048,
  storage_type: 'cloudinary',
  storage_path: 'users/user-1/photo',
  download_url: 'https://res.cloudinary.com/demo/image/upload/v1/users/user-1/photo.jpg',
};

function withFile(
  overrides: Partial<typeof FILE> = {},
  embeddings: TableAnswer = { data: [] },
  pieces: TableAnswer = { data: [] }
) {
  const mock = mockSupabase({
    files: { data: [{ ...FILE, ...overrides }] } as TableAnswer,
    file_embeddings: embeddings,
    file_chunks: pieces,
  });
  db.client = mock.client;
  db.calls = mock.calls;
}

const index = (fileId?: string) =>
  mockRequest({ query: { action: 'index' }, body: fileId ? { fileId } : {} });

const search = (text?: unknown) => mockRequest({ query: { action: 'embed' }, body: { text } });

/** A file this model has described and cut, as the two tables answer for it. */
const SAID_BEFORE: TableAnswer = {
  data: [{ summary: 'Said before.', tags: ['earlier'], summary_model: 'claude-opus-5-5' }],
};
const HAS_PIECES: TableAnswer = { data: [{ chunk_index: 0 }] };

/** The pieces the handler inserted, as they were handed to Supabase. */
function insertedPieces(): Record<string, unknown>[] {
  const call = db.calls.find((c) => c.table === 'file_chunks' && c.op === 'insert');
  return (call?.args?.[0] ?? []) as Record<string, unknown>[];
}

/** A download of `body`, for a file the indexer reads. */
function serving(body: string | Uint8Array) {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => String(bytes.byteLength) },
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    })
  );
}

/** The row the handler upserted, as it was handed to Supabase. */
function upsertedRow(): Record<string, unknown> {
  const call = db.calls.find((c) => c.table === 'file_embeddings' && c.op === 'upsert');
  return (call?.args?.[0] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Module-scope singletons: what one test spends stays spent without this.
  resetRateLimits();
  authenticate.mockResolvedValue({ id: 'user-1', email: 'alex@example.com' });
  describeFile.mockResolvedValue({
    summary: 'Two people on a bridge in Prague.',
    tags: ['prague', 'bridge'],
    model: 'claude-opus-5-5',
  });
  embed.mockResolvedValue(VECTOR);
  embedMany.mockImplementation(async (texts: string[]) => texts.map(() => VECTOR));
  rpc.mockResolvedValue({ data: 'ok', error: null });
  supports.mockReturnValue(true);
  readsPdf.value = true;
  maxImageBytes.value = undefined;
  cloudflareReady.mockReturnValue(false);
  pdfText.mockResolvedValue('');
  activeBackend.mockReturnValue({
    embeddingModel: EMBEDDING_MODEL,
    supports: (kind: string) => supports(kind),
    get readsPdf() {
      return readsPdf.value;
    },
    get maxImageBytes() {
      return maxImageBytes.value;
    },
    describe: (...args: unknown[]) => describeFile(...args),
    embed: (...args: unknown[]) => embed(...args),
    embedMany: (...args: unknown[]) => embedMany(...(args as [string[]])),
    answerModel: '@cf/mistralai/mistral-small-3.1-24b-instruct',
    answer: (...args: unknown[]) => answer(...args),
  });
  callerRpc.mockResolvedValue({ data: [], error: null });
  answer.mockImplementation(async function* () {
    yield 'The rent is 950 euros ';
    yield '[1].';
  });
  presign.mockResolvedValue('https://r2.example/signed');
  createSignedUrl.mockResolvedValue({
    data: { signedUrl: 'https://supa.example/signed' },
    error: null,
  });
  withFile();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('access', () => {
  it('refuses anything but POST', async () => {
    const res = mockResponse();
    await handler(mockRequest({ method: 'GET' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('answers 401 when the caller is not signed in', async () => {
    authenticate.mockRejectedValue(new FakeAuthError('Invalid or expired token'));
    const res = mockResponse();
    await handler(index('file-1'), res);

    expect(res.statusCode).toBe(401);
    expect(describeFile).not.toHaveBeenCalled();
  });

  it('names the model this deployment indexes with, asking no model and claiming nothing', async () => {
    authenticate.mockResolvedValue({ id: 'user-1', email: 'alex@example.com' });
    const res = mockResponse();

    await handler(mockRequest({ query: { action: 'model' } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ model: EMBEDDING_MODEL });
    expect(rpc).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
  });

  it('answers 501 for the model where no backend is configured', async () => {
    authenticate.mockResolvedValue({ id: 'user-1', email: 'alex@example.com' });
    activeBackend.mockImplementation(() => {
      throw new ProviderNotConfigured('no keys');
    });
    const res = mockResponse();

    await handler(mockRequest({ query: { action: 'model' } }), res);

    expect(res.statusCode).toBe(501);
  });

  it('answers 404 for a segment that is neither action', async () => {
    const res = mockResponse();
    await handler(mockRequest({ query: { action: 'summarise' } }), res);
    expect(res.statusCode).toBe(404);
  });
});

describe('index', () => {
  it('requires a fileId', async () => {
    const res = mockResponse();
    await handler(index(), res);
    expect(res.statusCode).toBe(400);
  });

  it('answers 404 for a file that is not the caller’s, and asks the database that way', async () => {
    db.client = mockSupabase({ files: { data: [] } as TableAnswer }).client;
    const res = mockResponse();
    await handler(index('someone-elses-file'), res);

    expect(res.statusCode).toBe(404);
    expect(describeFile).not.toHaveBeenCalled();
  });

  it('filters by owner in the query rather than checking afterwards', async () => {
    await handler(index('file-1'), mockResponse());

    // Two equalities: the id and the owner. The service-role key bypasses
    // RLS, so this filter is the only thing between a caller and another
    // account's row.
    expect(db.calls.filter((c) => c.table === 'files' && c.op === 'eq')).toHaveLength(2);
  });

  it('describes a Cloudinary image straight from its delivery URL', async () => {
    const res = mockResponse();
    await handler(index('file-1'), res);

    expect(describeFile).toHaveBeenCalledWith('photo.jpg', {
      kind: 'image',
      url: FILE.download_url,
      mediaType: 'image/jpeg',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ indexed: true, summary: 'Two people on a bridge in Prague.' });
  });

  it('embeds the name, the summary and the tags together, as a document', async () => {
    await handler(index('file-1'), mockResponse());

    const [text, inputType] = embed.mock.calls[0] as [string, string];
    expect(text).toContain('photo.jpg');
    expect(text).toContain('Two people on a bridge in Prague.');
    expect(text).toContain('prague, bridge');
    // The query side is embedded with 'query'; mixing the two answers a
    // different question than the one being asked.
    expect(inputType).toBe('document');
  });

  it('stores the vector in the format pgvector parses, with both models', async () => {
    await handler(index('file-1'), mockResponse());

    expect(upsertedRow()).toMatchObject({
      file_id: 'file-1',
      user_id: 'user-1',
      summary: 'Two people on a bridge in Prague.',
      tags: ['prague', 'bridge'],
      embedding: JSON.stringify(VECTOR),
      summary_model: 'claude-opus-5-5',
      embedding_model: EMBEDDING_MODEL,
    });
  });

  it('signs a fresh URL for R2, where the stored one expired long ago', async () => {
    withFile({ storage_type: 'r2', storage_path: 'users/user-1/report.png', type: 'image/png' });
    await handler(index('file-1'), mockResponse());

    expect(presign).toHaveBeenCalled();
    expect(describeFile).toHaveBeenCalledWith(
      'photo.jpg',
      expect.objectContaining({ url: 'https://r2.example/signed' })
    );
  });

  it('signs a fresh URL for Supabase Storage as well', async () => {
    withFile({ storage_type: 'supabase_storage', storage_path: 'user-1/1700000000_photo.jpg' });
    await handler(index('file-1'), mockResponse());

    expect(createSignedUrl).toHaveBeenCalledWith('user-1/1700000000_photo.jpg', 300);
    expect(describeFile).toHaveBeenCalledWith(
      'photo.jpg',
      expect.objectContaining({ url: 'https://supa.example/signed' })
    );
  });

  it('reads a text file and sends only the sample', async () => {
    const body = 'x'.repeat(TEXT_SAMPLE_BYTES + 500);
    serving(body);
    withFile({ name: 'notes.txt', type: 'text/plain' });

    await handler(index('file-1'), mockResponse());

    const [, source] = describeFile.mock.calls[0] as [string, { kind: string; text: string }];
    expect(source.kind).toBe('text');
    expect(source.text).toHaveLength(TEXT_SAMPLE_BYTES);
  });

  it('refuses a row pointing at another account\u2019s object', async () => {
    /* RLS decides which rows an account may write, not what may go in them —
       so a caller can put somebody else's path in their own row. The indexer
       holds the service-role key, which consults neither Storage's policies
       nor the bucket, so this check is the only one there is. */
    withFile({ storage_type: 'supabase_storage', storage_path: 'user-2/private.pdf' });
    const res = mockResponse();
    await handler(index('file-1'), res);

    expect(res.statusCode).toBe(403);
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(describeFile).not.toHaveBeenCalled();
  });

  it('refuses a Cloudinary URL that is not ours', async () => {
    // Same column, the other half of the problem: download_url is obeyed, and
    // it is written by the browser. Without this the route fetches whatever it
    // is pointed at and hands back a description of the answer.
    withFile({ download_url: 'http://169.254.169.254/latest/meta-data/' });
    const res = mockResponse();
    await handler(index('file-1'), res);

    expect(res.statusCode).toBe(403);
    expect(describeFile).not.toHaveBeenCalled();
  });

  it('says why a file was skipped instead of failing', async () => {
    withFile({ storage_type: 'googledrive' });
    const res = mockResponse();
    await handler(index('file-1'), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      indexed: false,
      reason: expect.stringContaining('own cloud'),
    });
    // Nothing was paid for: no description, no embedding, and no claim on
    // the day's budget for either.
    expect(describeFile).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not spend a model call on a demo account', async () => {
    // /api/demo/session hands an account to anyone who opens the site, and
    // describing a file is the one thing here that costs money per call.
    authenticate.mockResolvedValue({ id: 'user-1', email: 'demo-1700000000-ab12@example.com' });
    const res = mockResponse();
    await handler(index('file-1'), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ indexed: false, reason: expect.stringContaining('demo') });
    expect(describeFile).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('names the migration when the table is not there yet', async () => {
    withFile({}, { error: { message: 'relation "public.file_embeddings" does not exist' } });
    const res = mockResponse();
    await handler(index('file-1'), res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ message: expect.stringContaining('migrations/011') });
  });

  it('skips a file the configured backend cannot read', async () => {
    // Storing a confident sentence about a file nobody looked at would be
    // worse than saying so.
    supports.mockReturnValue(false);
    withFile({ name: 'invoice.pdf', type: 'application/pdf' });
    const res = mockResponse();
    await handler(index('file-1'), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ indexed: false, reason: expect.stringContaining('pdf') });
    expect(describeFile).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('answers 501 when no provider is configured at all', async () => {
    activeBackend.mockImplementation(() => {
      throw new ProviderNotConfigured('No AI provider is configured');
    });
    const res = mockResponse();
    await handler(index('file-1'), res);

    expect(res.statusCode).toBe(501);
  });

  /* The dashboard offers only the files the model on screen has not indexed,
     but the route can be called without it, and before this every call was a
     description paid for again: one file was enough to spend without end. */
  it('gives a file this model has indexed its stored description, and pays for nothing', async () => {
    withFile({}, SAID_BEFORE, HAS_PIECES);
    const res = mockResponse();
    await handler(index('file-1'), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      indexed: true,
      summary: 'Said before.',
      tags: ['earlier'],
      model: 'claude-opus-5-5',
    });
    expect(describeFile).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(db.calls.some((c) => c.op === 'upsert')).toBe(false);
  });

  it('claims a call from the day\u2019s budget before it pays for one', async () => {
    await handler(index('file-1'), mockResponse());

    expect(rpc).toHaveBeenCalledWith('claim_ai_call', {
      p_user: 'user-1',
      p_action: 'index',
      p_user_limit: AI_DAILY_LIMITS.index.perAccount,
      p_total_limit: AI_DAILY_LIMITS.index.total,
    });
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(
      describeFile.mock.invocationCallOrder[0] ?? 0
    );
  });

  it.each(['account', 'deployment'])(
    'answers 429 until midnight UTC when the %s budget is spent, and pays for nothing',
    async (scope) => {
      rpc.mockResolvedValue({ data: scope, error: null });
      const res = mockResponse();
      await handler(index('file-1'), res);

      expect(res.statusCode).toBe(429);
      // What happened, not when: the moment is `retryAt`, said by the app in local time.
      expect(res.body).toMatchObject({
        message: expect.stringContaining('today'),
        // Within seconds of midnight: Retry-After rounds up, and a loaded run is slow.
        retryAt: expect.stringMatching(/T00:00:0\d/),
      });
      const retryAfter = Number(
        vi.mocked(res.setHeader).mock.calls.find(([name]) => name === 'Retry-After')?.[1]
      );
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(86_400);
      expect(describeFile).not.toHaveBeenCalled();
      expect(embed).not.toHaveBeenCalled();
    }
  );

  /* The deployment's limit is the one its owner set, and reaching it is worth
     knowing the same day. An account reaching its own is the limit working. */
  it('reports the deployment\u2019s budget running out, and not an account\u2019s', async () => {
    rpc.mockResolvedValue({ data: 'account', error: null });
    await handler(index('file-1'), mockResponse());
    expect(report).not.toHaveBeenCalled();

    rpc.mockResolvedValue({ data: 'deployment', error: null });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await handler(index('file-1'), mockResponse());
    expect(report).toHaveBeenCalledWith(expect.any(Error), {
      route: 'ai/index',
      level: 'warning',
    });
  });

  it('refuses to pay when the budget cannot be checked', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'connection reset' } });
    const res = mockResponse();
    await handler(index('file-1'), res);

    expect(res.statusCode).toBe(500);
    expect(describeFile).not.toHaveBeenCalled();
  });

  it('names the migration when the budget is not set up', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.claim_ai_call' },
    });
    const res = mockResponse();
    await handler(index('file-1'), res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ message: expect.stringContaining('migrations/017') });
  });

  it('stops a caller who indexes in a loop', async () => {
    for (let i = 0; i < AI_INDEX_LIMIT; i++) {
      await handler(index('file-1'), mockResponse());
    }
    const res = mockResponse();
    await handler(index('file-1'), res);

    expect(res.statusCode).toBe(429);
  });
});

describe('embed', () => {
  it('requires something to search for', async () => {
    const res = mockResponse();
    await handler(search('   '), res);
    expect(res.statusCode).toBe(400);
  });

  it('refuses a whole document pasted into the search box', async () => {
    const res = mockResponse();
    await handler(search('x'.repeat(501)), res);

    expect(res.statusCode).toBe(400);
    expect(embed).not.toHaveBeenCalled();
  });

  it('returns the vector for the browser to ask the database with', async () => {
    const res = mockResponse();
    await handler(search('hotel invoice'), res);

    expect(embed).toHaveBeenCalledWith('hotel invoice', 'query');
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ embedding: VECTOR, model: EMBEDDING_MODEL });
  });

  it('answers 501 when the deployment has no key for the provider', async () => {
    embed.mockRejectedValue(new ProviderNotConfigured('VOYAGE_API_KEY is not configured'));
    const res = mockResponse();
    await handler(search('hotel invoice'), res);

    // Not 500: the client cannot see the server's variables and would retry
    // twice on the way to the same answer.
    expect(res.statusCode).toBe(501);
  });

  it('claims a search from the day\u2019s budget', async () => {
    await handler(search('hotel invoice'), mockResponse());

    expect(rpc).toHaveBeenCalledWith(
      'claim_ai_call',
      expect.objectContaining({ p_user: 'user-1', p_action: 'embed' })
    );
  });

  it('answers 429 when the day\u2019s searches are spent, and embeds nothing', async () => {
    rpc.mockResolvedValue({ data: 'deployment', error: null });
    const res = mockResponse();
    await handler(search('hotel invoice'), res);

    expect(res.statusCode).toBe(429);
    expect(res.body).toMatchObject({ message: expect.stringContaining('by name') });
    expect(embed).not.toHaveBeenCalled();
  });

  /* Production has no keys yet, and the table arrives with migrations/017: a
     deployment without either must go on answering 501, not 500. */
  it('asks the budget nothing when no provider is configured', async () => {
    activeBackend.mockImplementation(() => {
      throw new ProviderNotConfigured('No AI provider is configured');
    });
    const res = mockResponse();
    await handler(search('hotel invoice'), res);

    expect(res.statusCode).toBe(501);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('the pieces a question is answered from (ADR 0019)', () => {
  it('cuts a text file whole, not the sample the description reads', async () => {
    const body = 'Clause one says the rent is 950 euros.\n\n'.repeat(400);
    serving(body);
    withFile({ name: 'lease.txt', type: 'text/plain' });

    const res = mockResponse();
    await handler(index('file-1'), res);

    const expected = chunkText(body, CHUNK_SIZE, CHUNK_OVERLAP).slice(0, MAX_PIECES_PER_FILE);
    expect(expected.length).toBeGreaterThan(TEXT_SAMPLE_BYTES / CHUNK_SIZE);
    expect(insertedPieces().map((row) => row.content)).toEqual(expected);
    expect(res.body).toMatchObject({ indexed: true, pieces: expected.length });
  });

  it('keeps at most MAX_PIECES_PER_FILE pieces of a long file', async () => {
    serving('A sentence of the file that goes on. '.repeat(5000));
    withFile({ name: 'book.txt', type: 'text/plain' });

    await handler(index('file-1'), mockResponse());

    expect(insertedPieces()).toHaveLength(MAX_PIECES_PER_FILE);
    // Read only as far as the kept pieces reach, and the same pieces.
    expect(insertedPieces().map((row) => row.content)).toEqual(
      chunkText(
        'A sentence of the file that goes on. '.repeat(5000),
        CHUNK_SIZE,
        CHUNK_OVERLAP
      ).slice(0, MAX_PIECES_PER_FILE)
    );
    expect(insertedPieces().map((row) => row.chunk_index)).toEqual([
      ...Array(MAX_PIECES_PER_FILE).keys(),
    ]);
  });

  it('embeds each piece under the file\u2019s name, as a document, and stores it with the model', async () => {
    serving('The rent is 950 euros.');
    withFile({ name: 'lease.txt', type: 'text/plain' });

    await handler(index('file-1'), mockResponse());

    expect(embedMany).toHaveBeenCalledWith(['lease.txt\nThe rent is 950 euros.'], 'document');
    expect(insertedPieces()).toEqual([
      {
        file_id: 'file-1',
        chunk_index: 0,
        user_id: 'user-1',
        content: 'The rent is 950 euros.',
        embedding: `[${VECTOR.join(',')}]`,
        embedding_model: EMBEDDING_MODEL,
      },
    ]);
  });

  it('replaces a file\u2019s pieces rather than adding to them', async () => {
    serving('The rent is 950 euros.');
    withFile({ name: 'lease.txt', type: 'text/plain' });

    await handler(index('file-1'), mockResponse());

    const writes = db.calls.filter(
      (c) => c.table === 'file_chunks' && (c.op === 'delete' || c.op === 'insert')
    );
    expect(writes.map((c) => c.op)).toEqual(['delete', 'insert']);
    const owner = db.calls.filter((c) => c.table === 'file_chunks' && c.op === 'eq');
    expect(owner.map((c) => c.args)).toEqual(
      expect.arrayContaining([
        ['file_id', 'file-1'],
        ['user_id', 'user-1'],
      ])
    );
  });

  it('cuts a picture\u2019s pieces from its description', async () => {
    await handler(index('file-1'), mockResponse());

    expect(insertedPieces().map((row) => row.content)).toEqual([
      'Two people on a bridge in Prague.',
    ]);
  });

  it('gives a described file its pieces without describing it again', async () => {
    withFile({}, SAID_BEFORE);
    const res = mockResponse();

    await handler(index('file-1'), res);

    expect(describeFile).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
    expect(db.calls.some((c) => c.table === 'file_embeddings' && c.op === 'upsert')).toBe(false);
    expect(insertedPieces().map((row) => row.content)).toEqual(['Said before.']);
    expect(rpc).toHaveBeenCalledWith(
      'claim_ai_call',
      expect.objectContaining({ p_action: 'index' })
    );
    expect(res.body).toMatchObject({ indexed: true, summary: 'Said before.', pieces: 1 });
  });

  it('reads a described text file again for its pieces', async () => {
    serving('The deposit is 1900 euros.');
    withFile({ name: 'lease.txt', type: 'text/plain' }, SAID_BEFORE);

    await handler(index('file-1'), mockResponse());

    expect(describeFile).not.toHaveBeenCalled();
    expect(insertedPieces().map((row) => row.content)).toEqual(['The deposit is 1900 euros.']);
  });

  /* What Notepad saves as "Unicode". Read as UTF-8 it was a NUL after every
     letter, and Postgres refuses a NUL: the file could never be indexed. */
  it('reads a UTF-16 text file as its text, with no NUL to refuse', async () => {
    serving(
      new Uint8Array(
        Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('The rent is 950 euros.', 'utf16le')])
      )
    );
    withFile({ name: 'lease.txt', type: 'text/plain' });

    await handler(index('file-1'), mockResponse());

    expect(insertedPieces().map((row) => row.content)).toEqual(['The rent is 950 euros.']);
    expect(describeFile).toHaveBeenCalledWith('lease.txt', {
      kind: 'text',
      text: 'The rent is 950 euros.',
    });
  });

  it('keeps no NUL in a piece', async () => {
    serving('The rent\u0000 is 950 euros.');
    withFile({ name: 'lease.txt', type: 'text/plain' });

    await handler(index('file-1'), mockResponse());

    expect(insertedPieces().map((row) => row.content)).toEqual(['The rent is 950 euros.']);
  });

  it('names migration 022 when the table for the pieces is missing', async () => {
    const mock = mockSupabase({
      files: { data: [FILE] } as TableAnswer,
      file_embeddings: { data: [] },
      file_chunks: { error: { message: 'relation "public.file_chunks" does not exist' } },
    });
    db.client = mock.client;
    db.calls = mock.calls;
    const res = mockResponse();

    await handler(index('file-1'), res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ message: expect.stringContaining('migrations/022') });
  });
});

describe('a PDF', () => {
  const PDF = { name: 'factura.pdf', type: 'application/pdf' };
  const TEXT = 'Importe total a pagar: 86,40 euros.\n\nFecha de cargo: 15 de abril.';

  beforeEach(() => serving(new Uint8Array([37, 80, 68, 70])));

  it('is described from its text on a backend that cannot read one, and cut from it', async () => {
    readsPdf.value = false;
    cloudflareReady.mockReturnValue(true);
    pdfText.mockResolvedValue(TEXT);
    withFile(PDF);

    await handler(index('file-1'), mockResponse());

    expect(pdfText).toHaveBeenCalledWith(expect.any(Buffer), 'factura.pdf');
    expect(describeFile).toHaveBeenCalledWith('factura.pdf', { kind: 'text', text: TEXT });
    expect(insertedPieces().map((row) => row.content)).toEqual(
      chunkText(TEXT, CHUNK_SIZE, CHUNK_OVERLAP)
    );
  });

  it('with no text is refused for free on a backend that cannot read one', async () => {
    readsPdf.value = false;
    cloudflareReady.mockReturnValue(true);
    pdfText.mockResolvedValue('   ');
    withFile(PDF);
    const res = mockResponse();

    await handler(index('file-1'), res);

    expect(res.body).toMatchObject({ indexed: false, reason: expect.stringContaining('scanned') });
    expect(describeFile).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(insertedPieces()).toEqual([]);
  });

  it('goes to Claude as it is, and is cut from its text when Cloudflare can read it', async () => {
    cloudflareReady.mockReturnValue(true);
    pdfText.mockResolvedValue(TEXT);
    withFile(PDF);

    await handler(index('file-1'), mockResponse());

    expect(describeFile).toHaveBeenCalledWith('factura.pdf', { kind: 'pdf', data: 'JVBERg==' });
    // Two short paragraphs fit in one piece.
    expect(insertedPieces().map((row) => row.content)).toEqual([TEXT]);
  });

  /* Claude reads the PDF itself; the text is only for the pieces, which the
     description can give. A converter that is down must not leave the file
     unindexed. */
  it('goes to Claude even when toMarkdown fails, reported, and is cut from the description', async () => {
    cloudflareReady.mockReturnValue(true);
    pdfText.mockRejectedValue(new Error('toMarkdown answered 503'));
    withFile(PDF);
    const res = mockResponse();

    await handler(index('file-1'), res);

    expect(res.statusCode).toBe(200);
    expect(describeFile).toHaveBeenCalledWith('factura.pdf', { kind: 'pdf', data: 'JVBERg==' });
    expect(insertedPieces().map((row) => row.content)).toEqual([
      'Two people on a bridge in Prague.',
    ]);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'toMarkdown answered 503' }),
      expect.objectContaining({ route: 'ai/index', level: 'warning' })
    );
  });

  it('fails on the free path when toMarkdown fails, having nothing else to read', async () => {
    readsPdf.value = false;
    cloudflareReady.mockReturnValue(true);
    pdfText.mockRejectedValue(new Error('toMarkdown answered 503'));
    withFile(PDF);
    const res = mockResponse();

    await handler(index('file-1'), res);

    expect(res.statusCode).toBe(500);
    expect(describeFile).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('is cut from Claude\u2019s description when there is no Cloudflare account to read it', async () => {
    withFile(PDF);

    await handler(index('file-1'), mockResponse());

    expect(pdfText).not.toHaveBeenCalled();
    expect(insertedPieces().map((row) => row.content)).toEqual([
      'Two people on a bridge in Prague.',
    ]);
  });
});

/* The 3.4 MB photo of 2026-11-21 failed with a 500 and an error in Sentry:
   the free path's model takes pictures up to 3 MB, and saying so is a reason,
   not a failure. */
describe('a picture larger than the model takes', () => {
  /* Supabase Storage makes smaller copies only on a paid plan. */
  it('is skipped with the reason, before anything is paid for', async () => {
    maxImageBytes.value = 3 * 1024 * 1024;
    withFile({
      size: 3_459_911,
      storage_type: 'supabase_storage',
      storage_path: 'user-1/1700000000_photo.jpg',
    });
    const res = mockResponse();

    await handler(index('file-1'), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      indexed: false,
      reason: "this file is larger than the 3 MB this deployment's model can look at",
    });
    expect(describeFile).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('is skipped too when it turns out larger as it is read, and nothing is reported', async () => {
    const { FileTooLarge } = await import('../../libs/server/src/fetch-bytes');
    describeFile.mockRejectedValue(new FileTooLarge(3 * 1024 * 1024));
    const res = mockResponse();

    await handler(index('file-1'), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ indexed: false, reason: expect.stringContaining('3 MB') });
    expect(report).not.toHaveBeenCalled();
  });

  /* The 3.4 MB photo again: on Cloudinary, it is described from a copy of
     2048 pixels at most, about 180 kB, and the original is not touched. */
  it('is described from a smaller copy where it is on Cloudinary', async () => {
    maxImageBytes.value = 3 * 1024 * 1024;
    withFile({ size: 3_459_911, type: 'image/heic' });
    const res = mockResponse();

    await handler(index('file-1'), res);

    expect(describeFile).toHaveBeenCalledWith('photo.jpg', {
      kind: 'image',
      url: 'https://res.cloudinary.com/demo/image/upload/c_limit,w_2048,h_2048,q_auto,f_jpg/v1/users/user-1/photo.jpg',
      // The copy is a JPEG whatever the original was: f_jpg.
      mediaType: 'image/jpeg',
    });
    expect(res.body).toMatchObject({ indexed: true });
  });

  it('is described as it is while it fits, with no copy asked for', async () => {
    maxImageBytes.value = 3 * 1024 * 1024;
    withFile({ size: 3 * 1024 * 1024 });

    await handler(index('file-1'), mockResponse());

    expect(describeFile).toHaveBeenCalledWith('photo.jpg', {
      kind: 'image',
      url: FILE.download_url,
      mediaType: 'image/jpeg',
    });
  });

  it('goes to a model with no limit of its own', async () => {
    withFile({ size: 3_459_911 });

    await handler(index('file-1'), mockResponse());

    expect(describeFile).toHaveBeenCalled();
  });
});

describe('ask (ADR 0019)', () => {
  const ask = (question?: unknown, email = 'alex@example.com') => {
    authenticate.mockResolvedValue({ id: 'user-1', email });
    return mockRequest({ query: { action: 'ask' }, body: { question } });
  };
  const PIECES = [
    {
      file_id: 'f-1',
      file_name: 'lease.pdf',
      chunk_index: 2,
      content: 'The rent is 950 euros.',
      similarity: 0.71,
    },
    {
      file_id: 'f-2',
      file_name: 'bill.pdf',
      chunk_index: 0,
      content: 'Total: 86,40 euros.',
      similarity: 0.42,
    },
  ];
  /** The lines of the streamed answer, read back as the browser reads them. */
  const lines = (res: ReturnType<typeof mockResponse>) =>
    res.written
      .join('')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);

  it('refuses an empty question, and one too long, before anything is claimed', async () => {
    for (const question of [undefined, '   ', 'x'.repeat(501)]) {
      const res = mockResponse();
      await handler(ask(question), res);
      expect(res.statusCode).toBe(400);
    }
    expect(rpc).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
  });

  it('claims the question, embeds it as a query, and searches as the caller', async () => {
    callerRpc.mockResolvedValue({ data: PIECES, error: null });

    await handler(ask('  How much is the rent?  '), mockResponse());

    expect(rpc).toHaveBeenCalledWith('claim_ai_call', expect.objectContaining({ p_action: 'ask' }));
    expect(embed).toHaveBeenCalledWith('How much is the rent?', 'query');
    expect(callerRpc).toHaveBeenCalledWith('match_chunks', {
      query_embedding: `[${VECTOR.join(',')}]`,
      model_name: EMBEDDING_MODEL,
      match_count: 8,
      min_similarity: 0,
    });
    // The pieces are never read with the service role, which bypasses RLS.
    expect(db.calls.some((c) => c.table === 'file_chunks')).toBe(false);
  });

  it('streams the numbered sources first, then the answer, then done', async () => {
    callerRpc.mockResolvedValue({ data: PIECES, error: null });
    const res = mockResponse();

    await handler(ask('How much is the rent?'), res);

    expect(res.statusCode).toBe(200);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/x-ndjson; charset=utf-8'
    );
    expect(lines(res)).toEqual([
      {
        type: 'sources',
        model: '@cf/mistralai/mistral-small-3.1-24b-instruct',
        sources: [
          {
            n: 1,
            fileId: 'f-1',
            fileName: 'lease.pdf',
            chunkIndex: 2,
            content: 'The rent is 950 euros.',
          },
          {
            n: 2,
            fileId: 'f-2',
            fileName: 'bill.pdf',
            chunkIndex: 0,
            content: 'Total: 86,40 euros.',
          },
        ],
      },
      { type: 'text', text: 'The rent is 950 euros ' },
      { type: 'text', text: '[1].' },
      { type: 'done' },
    ]);
    expect(answer).toHaveBeenCalledWith(
      [
        {
          n: 1,
          fileId: 'f-1',
          fileName: 'lease.pdf',
          chunkIndex: 2,
          content: 'The rent is 950 euros.',
        },
        {
          n: 2,
          fileId: 'f-2',
          fileName: 'bill.pdf',
          chunkIndex: 0,
          content: 'Total: 86,40 euros.',
        },
      ],
      'How much is the rent?',
      expect.any(AbortSignal)
    );
    expect(res.end).toHaveBeenCalled();
  });

  it('stops the model when the person goes away, and reports nothing', async () => {
    callerRpc.mockResolvedValue({ data: PIECES, error: null });
    const res = mockResponse();
    let signal: AbortSignal | undefined;
    answer.mockImplementation(async function* (_e: unknown, _q: unknown, s: AbortSignal) {
      signal = s;
      yield 'The rent ';
      res.disconnect();
      yield 'is 950 euros.';
    });

    await handler(ask('How much is the rent?'), res);

    expect(signal?.aborted).toBe(true);
    expect(lines(res).map((line) => line.type)).toEqual(['sources', 'text']);
    expect(report).not.toHaveBeenCalled();
  });

  /* Stop pressed while the pieces were still being found: the connection is
     gone before the first word, and the model would have written the whole
     answer to nobody. */
  it('asks no model when the person went away while the pieces were found', async () => {
    callerRpc.mockResolvedValue({ data: PIECES, error: null });
    const res = mockResponse();
    embed.mockImplementation(async () => {
      res.disconnect();
      return VECTOR;
    });

    await handler(ask('How much is the rent?'), res);

    expect(answer).not.toHaveBeenCalled();
    expect(res.written).toEqual([]);
    expect(res.end).toHaveBeenCalled();
  });

  /* Without it, Vercel tells the function nothing when the browser goes:
     "Cancellation is opt-in" (Functions API reference, "Cancel requests"). */
  it('is told on Vercel that the person went away', () => {
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
      functions?: Record<string, unknown>;
    };
    expect(vercel.functions).toHaveProperty(['api/ai/*.ts', 'supportsCancellation'], true);
  });

  it('leaves the model alone once the answer is written', async () => {
    callerRpc.mockResolvedValue({ data: PIECES, error: null });
    const res = mockResponse();
    let signal: AbortSignal | undefined;
    answer.mockImplementation(async function* (_e: unknown, _q: unknown, s: AbortSignal) {
      signal = s;
      yield 'Done.';
    });

    await handler(ask('How much is the rent?'), res);

    // The connection closes after every answer; only a close before the end is a person leaving.
    expect(signal?.aborted).toBe(false);
  });

  it('asks no model when nothing is indexed to read', async () => {
    const res = mockResponse();

    await handler(ask('How much is the rent?'), res);

    expect(lines(res)).toEqual([
      { type: 'sources', model: '@cf/mistralai/mistral-small-3.1-24b-instruct', sources: [] },
      { type: 'done', empty: true },
    ]);
    expect(answer).not.toHaveBeenCalled();
  });

  it('ends a broken answer with an error line, and reports it', async () => {
    callerRpc.mockResolvedValue({ data: PIECES, error: null });
    answer.mockImplementation(async function* () {
      yield 'The rent';
      throw new Error('Workers AI answered 500');
    });
    const res = mockResponse();

    await handler(ask('How much is the rent?'), res);

    expect(lines(res).slice(-2)).toEqual([
      { type: 'text', text: 'The rent' },
      { type: 'error', message: 'The answer could not be finished. Try asking again.' },
    ]);
    expect(report).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ route: 'ai/ask' })
    );
    expect(res.end).toHaveBeenCalled();
  });

  it('says a refusal as it is, and reports nothing', async () => {
    const { AnswerRefused } = await import('../../libs/server/src/claude-answer');
    callerRpc.mockResolvedValue({ data: PIECES, error: null });
    answer.mockImplementation(async function* () {
      // Refused before a word: nothing to yield.
      yield* [];
      throw new AnswerRefused('The model would not answer this question.');
    });
    const res = mockResponse();

    await handler(ask('How much is the rent?'), res);

    expect(lines(res).at(-1)).toEqual({
      type: 'error',
      message: 'The model would not answer this question.',
    });
    expect(report).not.toHaveBeenCalled();
  });

  /* Every account may ask, as free as the rest of the app on the path
     production runs; the day's budget is what keeps it so. */
  it('answers a demo account too', async () => {
    callerRpc.mockResolvedValue({ data: PIECES, error: null });
    const res = mockResponse();

    await handler(ask('How much is the rent?', 'demo-1700000000-ab12@example.com'), res);

    expect(lines(res).at(-1)).toEqual({ type: 'done' });
  });

  it('stops at the day\u2019s budget before the stream begins', async () => {
    rpc.mockResolvedValue({ data: 'account', error: null });
    const res = mockResponse();

    await handler(ask('How much is the rent?'), res);

    expect(res.statusCode).toBe(429);
    expect(res.body).toMatchObject({ message: expect.stringContaining('questions') });
    // The moment the day's budget turns over, midnight UTC, for the screen to
    // show in the reader's own time. Retry-After is whole seconds, rounded up,
    // so it lands just after midnight and never before; a few seconds of slack
    // for a run under load, between the two readings of the clock.
    const retryAt = new Date((res.body as { retryAt: string }).retryAt).getTime();
    const now = new Date();
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    expect(retryAt).toBeGreaterThanOrEqual(midnight);
    expect(retryAt).toBeLessThan(midnight + 5000);
    expect(embed).not.toHaveBeenCalled();
    expect(res.written).toEqual([]);
  });

  it('allows ten questions a minute', async () => {
    for (let i = 0; i < 10; i++) await handler(ask('Rent?'), mockResponse());
    const res = mockResponse();

    await handler(ask('Rent?'), res);

    expect(res.statusCode).toBe(429);
  });

  it('names migration 022 when the search for pieces is missing', async () => {
    callerRpc.mockResolvedValue({
      data: null,
      error: { message: 'Could not find the function public.match_chunks' },
    });
    const res = mockResponse();

    await handler(ask('How much is the rent?'), res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ message: expect.stringContaining('migrations/022') });
  });
});
