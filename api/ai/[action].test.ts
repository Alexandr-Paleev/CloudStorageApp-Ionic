import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockRequest, mockResponse, mockSupabase, type TableAnswer } from '../../lib/test-utils';
import { AI_INDEX_LIMIT, resetRateLimits } from '../../lib/rate-limit';
import { EMBEDDING_MODEL, ProviderNotConfigured, TEXT_SAMPLE_BYTES } from '../../lib/ai';

const {
  FakeAuthError,
  authenticate,
  db,
  describeFile,
  embed,
  supports,
  activeBackend,
  createSignedUrl,
  presign,
} = vi.hoisted(() => ({
  FakeAuthError: class FakeAuthError extends Error {},
  authenticate: vi.fn(),
  db: {
    client: null as { from: (table: string) => unknown } | null,
    calls: [] as { table: string; op: string; args?: unknown[] }[],
  },
  describeFile: vi.fn(),
  embed: vi.fn(),
  supports: vi.fn(),
  activeBackend: vi.fn(),
  createSignedUrl: vi.fn(),
  presign: vi.fn(),
}));

vi.mock('../../lib/auth', () => ({
  AuthError: FakeAuthError,
  authenticate: (...args: unknown[]) => authenticate(...args),
  supabase: {
    from: (table: string) => db.client!.from(table),
    storage: {
      from: () => ({ createSignedUrl: (...args: unknown[]) => createSignedUrl(...args) }),
    },
  },
}));

// The backend is the seam between this route and whichever pair of models the
// deployment is configured for; the route's job is to pick one and use it.
vi.mock('../../lib/ai-provider', () => ({
  activeBackend: () => activeBackend(),
}));

// The S3 client wants credentials at construction, and none of this test is
// about signing — only about which URL reaches the model.
vi.mock('../../lib/r2', () => ({
  getS3Client: () => ({}),
  getR2BucketName: () => 'test-bucket',
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => presign(...args),
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

function withFile(overrides: Partial<typeof FILE> = {}, embeddings: TableAnswer = { data: [] }) {
  const mock = mockSupabase({
    files: { data: [{ ...FILE, ...overrides }] } as TableAnswer,
    file_embeddings: embeddings,
  });
  db.client = mock.client;
  db.calls = mock.calls;
}

const index = (fileId?: string) =>
  mockRequest({ query: { action: 'index' }, body: fileId ? { fileId } : {} });

const search = (text?: unknown) => mockRequest({ query: { action: 'embed' }, body: { text } });

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
    model: 'claude-opus-5',
  });
  embed.mockResolvedValue(VECTOR);
  supports.mockReturnValue(true);
  activeBackend.mockReturnValue({
    embeddingModel: EMBEDDING_MODEL,
    supports: (kind: string) => supports(kind),
    describe: (...args: unknown[]) => describeFile(...args),
    embed: (...args: unknown[]) => embed(...args),
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
      summary_model: 'claude-opus-5',
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
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => String(body.length) },
        arrayBuffer: async () => new TextEncoder().encode(body).buffer,
      })
    );
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
    // Nothing was paid for: no description, no embedding.
    expect(describeFile).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
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
  });

  it('names the migration when the table is not there yet', async () => {
    withFile({}, { error: { message: 'relation "public.file_embeddings" does not exist' } });
    const res = mockResponse();
    await handler(index('file-1'), res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ message: expect.stringContaining('migrations/011') });
  });

  it('skips a file the configured backend cannot read', async () => {
    // The free backend has no way to render a PDF page. Storing a confident
    // sentence about a file nobody looked at would be worse than saying so.
    supports.mockReturnValue(false);
    withFile({ name: 'invoice.pdf', type: 'application/pdf' });
    const res = mockResponse();
    await handler(index('file-1'), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ indexed: false, reason: expect.stringContaining('pdf') });
    expect(describeFile).not.toHaveBeenCalled();
  });

  it('answers 501 when no provider is configured at all', async () => {
    activeBackend.mockImplementation(() => {
      throw new ProviderNotConfigured('No AI provider is configured');
    });
    const res = mockResponse();
    await handler(index('file-1'), res);

    expect(res.statusCode).toBe(501);
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
});
