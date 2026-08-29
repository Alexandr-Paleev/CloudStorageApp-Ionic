import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockRequest, mockResponse, mockSupabase, type RecordedCall } from '../lib/test-utils';
import { hashShareToken } from '../lib/share';

const APP_URL = 'https://app.example';
const TOKEN = 'test-token-value';
const FILE_ID = 'file-1';

const { FakeAuthError, authenticateUser, db, signedUrl } = vi.hoisted(() => ({
  FakeAuthError: class FakeAuthError extends Error {},
  authenticateUser: vi.fn(),
  db: {
    client: null as { from: (t: string) => unknown } | null,
    calls: [] as { table: string; op: string; args?: unknown[] }[],
    storage: { createSignedUrl: vi.fn() },
  },
  signedUrl: vi.fn(),
}));

vi.mock('../lib/auth', () => ({
  AuthError: FakeAuthError,
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
  supabase: {
    from: (table: string) => db.client!.from(table),
    storage: { from: () => db.storage },
  },
}));

vi.mock('../lib/r2', () => ({
  getS3Client: () => ({}),
  getR2BucketName: () => 'bucket',
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => signedUrl(...args),
}));

import handler from './share';

const FILE_ROW = {
  id: FILE_ID,
  name: 'report.pdf',
  size: 1024,
  type: 'application/pdf',
  storage_path: 'users/user-1/report.pdf',
  storage_type: 'cloudinary',
  download_url: 'https://cdn.example/report.pdf',
  user_id: 'user-1',
};

function setup(tables: Record<string, { data?: unknown[] | null; error?: { message: string } }>) {
  const mock = mockSupabase(tables);
  db.client = mock.client;
  db.calls = mock.calls;
}

function liveLink(overrides: Record<string, unknown> = {}) {
  return {
    file_id: FILE_ID,
    expires_at: new Date(Date.now() + 86400_000).toISOString(),
    revoked_at: null,
    ...overrides,
  };
}

const post = (body: unknown) =>
  mockRequest({ method: 'POST', body, headers: { authorization: 'Bearer t', origin: APP_URL } });
const get = (query: Record<string, string>) => mockRequest({ method: 'GET', query });
const del = (query: Record<string, string>) =>
  mockRequest({ method: 'DELETE', query, headers: { authorization: 'Bearer t' } });

function writes(): RecordedCall[] {
  return (db.calls as RecordedCall[]).filter((c) => c.op === 'insert' || c.op === 'update');
}

beforeEach(() => {
  vi.clearAllMocks();
  authenticateUser.mockResolvedValue('user-1');
  signedUrl.mockResolvedValue('https://r2.example/signed');
  db.storage.createSignedUrl.mockResolvedValue({
    data: { signedUrl: 'https://supa.example/signed' },
    error: null,
  });
  setup({ files: { data: [FILE_ROW] }, shared_links: { data: [liveLink()] } });
});

describe('share: creating a link', () => {
  it('rejects an unauthenticated caller', async () => {
    authenticateUser.mockRejectedValue(new FakeAuthError('no token'));
    const res = mockResponse();
    await handler(post({ fileId: FILE_ID }), res);

    expect(res.statusCode).toBe(401);
    expect(writes()).toHaveLength(0);
  });

  it('requires a fileId', async () => {
    const res = mockResponse();
    await handler(post({}), res);
    expect(res.statusCode).toBe(400);
  });

  it('refuses to share a file the caller does not own', async () => {
    // The ownership query filters on user_id, so somebody else's file comes
    // back empty. Minting a link here would bypass authentication entirely.
    setup({ files: { data: [] }, shared_links: { data: [] } });
    const res = mockResponse();
    await handler(post({ fileId: 'someone-elses-file' }), res);

    expect(res.statusCode).toBe(404);
    expect(writes()).toHaveLength(0);
  });

  it('returns a URL on this deployment', async () => {
    const res = mockResponse();
    await handler(post({ fileId: FILE_ID }), res);

    expect(res.statusCode).toBe(201);
    const { url } = res.body as { url: string };
    expect(url.startsWith(`${APP_URL}/s/`)).toBe(true);
  });

  it('stores only the hash, never the token itself', async () => {
    const res = mockResponse();
    await handler(post({ fileId: FILE_ID }), res);

    const { url } = res.body as { url: string };
    const token = url.split('/s/')[1];
    const row = writes()[0].args?.[0] as Record<string, unknown>;

    expect(row.token_hash).toBe(hashShareToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it('sets an expiry', async () => {
    const res = mockResponse();
    await handler(post({ fileId: FILE_ID, expiresInDays: 3 }), res);

    const { expiresAt } = res.body as { expiresAt: string };
    const days = (new Date(expiresAt).getTime() - Date.now()) / 86400_000;
    expect(days).toBeGreaterThan(2.9);
    expect(days).toBeLessThan(3.1);
  });
});

describe('share: opening a link', () => {
  it('needs no authentication — that is the point', async () => {
    const res = mockResponse();
    await handler(get({ token: TOKEN }), res);

    expect(res.statusCode).toBe(200);
    expect(authenticateUser).not.toHaveBeenCalled();
  });

  it('requires a token', async () => {
    const res = mockResponse();
    await handler(get({}), res);
    expect(res.statusCode).toBe(400);
  });

  it('looks the link up by hash, not by the raw token', async () => {
    await handler(get({ token: TOKEN }), mockResponse());
    const eqCalls = (db.calls as RecordedCall[]).filter((c) => c.op === 'eq');
    expect(JSON.stringify(eqCalls)).not.toContain(TOKEN);
  });

  it('returns the file, and nothing about its owner', async () => {
    const res = mockResponse();
    await handler(get({ token: TOKEN }), res);

    expect(res.body).toEqual({
      name: 'report.pdf',
      size: 1024,
      type: 'application/pdf',
      downloadUrl: 'https://cdn.example/report.pdf',
    });
    expect(JSON.stringify(res.body)).not.toContain('user-1');
  });

  it('answers 404 for a token that was never issued', async () => {
    setup({ files: { data: [FILE_ROW] }, shared_links: { data: [] } });
    const res = mockResponse();
    await handler(get({ token: 'guessed' }), res);
    expect(res.statusCode).toBe(404);
  });

  it('answers 410 for a revoked link', async () => {
    setup({
      files: { data: [FILE_ROW] },
      shared_links: { data: [liveLink({ revoked_at: new Date().toISOString() })] },
    });
    const res = mockResponse();
    await handler(get({ token: TOKEN }), res);

    expect(res.statusCode).toBe(410);
    expect((res.body as { message: string }).message).toMatch(/revoked/i);
  });

  it('answers 410 for an expired link', async () => {
    setup({
      files: { data: [FILE_ROW] },
      shared_links: { data: [liveLink({ expires_at: '2020-01-01T00:00:00.000Z' })] },
    });
    const res = mockResponse();
    await handler(get({ token: TOKEN }), res);

    expect(res.statusCode).toBe(410);
    expect((res.body as { message: string }).message).toMatch(/expired/i);
  });

  it('handles a file deleted after the link was shared', async () => {
    setup({ files: { data: [] }, shared_links: { data: [liveLink()] } });
    const res = mockResponse();
    await handler(get({ token: TOKEN }), res);

    expect(res.statusCode).toBe(404);
    expect((res.body as { message: string }).message).toMatch(/no longer exists/i);
  });

  it('signs a URL for private R2 objects', async () => {
    setup({
      files: { data: [{ ...FILE_ROW, storage_type: 'r2' }] },
      shared_links: { data: [liveLink()] },
    });
    const res = mockResponse();
    await handler(get({ token: TOKEN }), res);

    expect((res.body as { downloadUrl: string }).downloadUrl).toBe('https://r2.example/signed');
  });

  it('signs a URL for private Supabase Storage objects', async () => {
    setup({
      files: { data: [{ ...FILE_ROW, storage_type: 'supabase_storage' }] },
      shared_links: { data: [liveLink()] },
    });
    const res = mockResponse();
    await handler(get({ token: TOKEN }), res);

    expect((res.body as { downloadUrl: string }).downloadUrl).toBe('https://supa.example/signed');
  });
});

describe('share: revoking a link', () => {
  it('rejects an unauthenticated caller', async () => {
    authenticateUser.mockRejectedValue(new FakeAuthError('no token'));
    const res = mockResponse();
    await handler(del({ id: 'link-1' }), res);
    expect(res.statusCode).toBe(401);
  });

  it('requires an id', async () => {
    const res = mockResponse();
    await handler(del({}), res);
    expect(res.statusCode).toBe(400);
  });

  it('marks the link revoked rather than deleting the row', async () => {
    setup({ shared_links: { data: [{ id: 'link-1' }] } });
    const res = mockResponse();
    await handler(del({ id: 'link-1' }), res);

    expect(res.statusCode).toBe(200);
    const update = writes()[0].args?.[0] as Record<string, unknown>;
    expect(update.revoked_at).toBeTruthy();
    expect((db.calls as RecordedCall[]).some((c) => c.op === 'delete')).toBe(false);
  });

  it('does not revoke a link belonging to somebody else', async () => {
    // The update filters on created_by, so another owner's row matches nothing.
    setup({ shared_links: { data: [] } });
    const res = mockResponse();
    await handler(del({ id: 'not-mine' }), res);
    expect(res.statusCode).toBe(404);
  });
});

describe('share: method routing', () => {
  it('refuses anything else', async () => {
    const res = mockResponse();
    await handler(mockRequest({ method: 'PATCH' }), res);
    expect(res.statusCode).toBe(405);
  });
});
