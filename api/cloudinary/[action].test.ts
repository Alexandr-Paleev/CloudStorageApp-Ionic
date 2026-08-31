import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockRequest, mockResponse, mockSupabase, type TableAnswer } from '../../lib/test-utils';
import { TIER_LIMITS } from '../../lib/tiers';

const { FakeAuthError, authenticateUser, db, destroy, config, apiSignRequest } = vi.hoisted(() => ({
  FakeAuthError: class FakeAuthError extends Error {},
  authenticateUser: vi.fn(),
  db: { client: null as { from: (table: string) => unknown } | null },
  destroy: vi.fn(),
  config: vi.fn(),
  apiSignRequest: vi.fn((_params: Record<string, unknown>, _secret: string) => 'the-signature'),
}));

vi.mock('../../lib/auth', () => ({
  AuthError: FakeAuthError,
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
  supabase: { from: (table: string) => db.client!.from(table) },
}));

vi.mock('cloudinary', () => ({
  v2: {
    config,
    uploader: { destroy },
    utils: {
      api_sign_request: (params: Record<string, unknown>, secret: string) =>
        apiSignRequest(params, secret),
    },
  },
}));

import handler from './[action]';

function withFiles(rows: { storage_path: string }[]) {
  db.client = mockSupabase({ files: { data: rows } as TableAnswer }).client;
}

/** Both actions live in one function; the segment is what picks between them. */
function del(publicId?: string, resourceType?: string) {
  return mockRequest({ query: { action: 'delete' }, body: { publicId, resourceType } });
}

function sign(body: Record<string, unknown> = {}) {
  return mockRequest({
    query: { action: 'sign' },
    body: { fileName: 'photo.png', size: 1024, contentType: 'image/png', ...body },
  });
}

function account(limit: number, used: number) {
  db.client = mockSupabase({
    profiles: { data: [{ storage_limit: limit, bytes_used: used }] } as TableAnswer,
    files: { data: [] } as TableAnswer,
  }).client;
}

beforeEach(() => {
  vi.clearAllMocks();
  authenticateUser.mockResolvedValue('user-1');
  withFiles([]);
  destroy.mockResolvedValue({ result: 'ok' });
  process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
  process.env.CLOUDINARY_API_KEY = 'test-key';
  process.env.CLOUDINARY_API_SECRET = 'test-secret';
});

describe('cloudinary delete: access', () => {
  it('refuses anything but POST', async () => {
    const res = mockResponse();
    await handler(mockRequest({ method: 'GET' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('answers 401 when the caller is not authenticated', async () => {
    authenticateUser.mockRejectedValue(new FakeAuthError('Missing authorization token'));
    const res = mockResponse();
    await handler(del('users/user-1/photo'), res);

    expect(res.statusCode).toBe(401);
    expect(destroy).not.toHaveBeenCalled();
  });

  it('requires a publicId', async () => {
    const res = mockResponse();
    await handler(del(undefined), res);
    expect(res.statusCode).toBe(400);
  });
});

describe('cloudinary delete: ownership', () => {
  it('refuses to delete an asset belonging to somebody else', async () => {
    // The bug this guards: any authenticated user could delete any asset by
    // passing its public_id.
    const res = mockResponse();
    await handler(del('users/someone-else/private-photo'), res);

    expect(res.statusCode).toBe(403);
    expect(destroy).not.toHaveBeenCalled();
  });

  it('does not call Cloudinary at all when ownership fails', async () => {
    withFiles([{ storage_path: 'users/user-1/mine.jpg' }]);
    const res = mockResponse();
    await handler(del('users/user-2/theirs.jpg'), res);

    expect(res.statusCode).toBe(403);
    expect(destroy).not.toHaveBeenCalled();
  });

  it('is not fooled by a caller id that merely prefixes another', async () => {
    // "user-1" must not grant access to "user-12"'s folder.
    authenticateUser.mockResolvedValue('user-1');
    const res = mockResponse();
    await handler(del('users/user-12/photo.jpg'), res);

    expect(res.statusCode).toBe(403);
  });

  it('deletes an asset in the caller own folder', async () => {
    const res = mockResponse();
    await handler(del('users/user-1/photo'), res);

    expect(res.statusCode).toBe(200);
    expect(destroy).toHaveBeenCalledWith('users/user-1/photo', { resource_type: 'image' });
  });

  it('accepts an asset owned via the files table, outside the folder convention', async () => {
    // Cloudinary accounts with dynamic folders store the folder separately, so
    // the public_id does not start with users/<id>/.
    withFiles([{ storage_path: 'legacy-asset-42' }]);
    const res = mockResponse();
    await handler(del('legacy-asset-42'), res);

    expect(res.statusCode).toBe(200);
  });

  it('matches a stored path that still carries its extension', async () => {
    // CloudinaryProvider strips the extension before calling this endpoint.
    withFiles([{ storage_path: 'legacy/photo.jpg' }]);
    const res = mockResponse();
    await handler(del('legacy/photo'), res);

    expect(res.statusCode).toBe(200);
  });

  it('does not accept an asset that belongs to no row of the caller', async () => {
    // The fallback must not degrade into "any id goes" when the table is empty.
    withFiles([]);
    const res = mockResponse();
    await handler(del('legacy-asset-42'), res);

    expect(res.statusCode).toBe(403);
    expect(destroy).not.toHaveBeenCalled();
  });
});

describe('cloudinary delete: result handling', () => {
  it('treats an already-deleted asset as success', async () => {
    destroy.mockResolvedValue({ result: 'not found' });
    const res = mockResponse();
    await handler(del('users/user-1/gone'), res);

    expect(res.statusCode).toBe(200);
    expect((res.body as { message: string }).message).toMatch(/may already be deleted/);
  });

  it('retries as raw when an image lookup comes back empty', async () => {
    // PDFs are stored as raw; without this the file would be orphaned.
    destroy.mockResolvedValueOnce({ result: 'not found' }).mockResolvedValueOnce({ result: 'ok' });
    const res = mockResponse();
    await handler(del('users/user-1/doc'), res);

    expect(destroy).toHaveBeenNthCalledWith(2, 'users/user-1/doc', { resource_type: 'raw' });
    expect(res.statusCode).toBe(200);
  });

  it('does not second-guess an explicit resourceType', async () => {
    destroy.mockResolvedValue({ result: 'not found' });
    const res = mockResponse();
    await handler(del('users/user-1/doc', 'raw'), res);

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  it('reports a genuine Cloudinary failure as 500', async () => {
    destroy.mockResolvedValue({ result: 'error' });
    const res = mockResponse();
    await handler(del('users/user-1/photo', 'image'), res);

    expect(res.statusCode).toBe(500);
  });
});

describe('cloudinary sign: authorizing an upload', () => {
  it("signs an upload that fits, into the caller's own folder", async () => {
    account(TIER_LIMITS.free.storage_limit, 0);
    const res = mockResponse();

    await handler(sign(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      folder: 'users/user-1',
      tags: 'user_user-1',
      cloudName: 'test-cloud',
      apiKey: 'test-key',
      signature: 'the-signature',
      resourceType: 'auto',
    });
  });

  it('signs exactly the parameters it hands back, and nothing else', async () => {
    // Cloudinary rejects the upload if the signed set and the sent set differ,
    // and an over-broad signature would let the client change what it sends.
    account(TIER_LIMITS.free.storage_limit, 0);
    const res = mockResponse();

    await handler(sign(), res);

    const [params, secret] = apiSignRequest.mock.calls[0];
    expect(Object.keys(params).sort()).toEqual(['folder', 'tags', 'timestamp']);
    expect(secret).toBe('test-secret');
    expect(res.body).toMatchObject({ timestamp: params.timestamp });
  });

  it('never lets the caller name the folder it uploads into', async () => {
    account(TIER_LIMITS.free.storage_limit, 0);
    const res = mockResponse();

    await handler(sign({ folder: 'users/someone-else', tags: 'user_someone-else' }), res);

    expect(res.body).toMatchObject({ folder: 'users/user-1', tags: 'user_user-1' });
  });

  it('marks a PDF as raw, the way the delete path expects to find it', async () => {
    account(TIER_LIMITS.free.storage_limit, 0);
    const res = mockResponse();

    await handler(sign({ fileName: 'report.pdf', contentType: 'application/pdf' }), res);

    expect(res.body).toMatchObject({ resourceType: 'raw' });
  });

  it('refuses to sign an upload that would not fit', async () => {
    account(TIER_LIMITS.free.storage_limit, TIER_LIMITS.free.storage_limit - 100);
    const res = mockResponse();

    await handler(sign({ size: 101 }), res);

    expect(res.statusCode).toBe(413);
    expect(res.body).toMatchObject({ message: expect.stringContaining('Storage limit exceeded') });
    expect(apiSignRequest).not.toHaveBeenCalled();
  });

  it('says how far over an account already is', async () => {
    // A cancelled Pro subscription leaves the account above the free limit.
    account(TIER_LIMITS.free.storage_limit, 3 * 1024 * 1024 * 1024);
    const res = mockResponse();

    await handler(sign(), res);

    expect(res.statusCode).toBe(413);
    expect((res.body as { message: string }).message).toContain('over the limit');
  });

  it('refuses an unauthenticated caller before reading anything', async () => {
    authenticateUser.mockRejectedValue(new FakeAuthError('Missing authorization token'));
    const res = mockResponse();

    await handler(sign(), res);

    expect(res.statusCode).toBe(401);
    expect(apiSignRequest).not.toHaveBeenCalled();
  });

  it('requires a file name and a size', async () => {
    account(TIER_LIMITS.free.storage_limit, 0);

    const noName = mockResponse();
    await handler(sign({ fileName: undefined }), noName);
    expect(noName.statusCode).toBe(400);

    const noSize = mockResponse();
    await handler(sign({ size: undefined }), noSize);
    expect(noSize.statusCode).toBe(400);
  });

  it('fails loudly when the server has no Cloudinary secret', async () => {
    // Silence here would mean falling back to an unsigned upload, which is the
    // hole this endpoint exists to close.
    account(TIER_LIMITS.free.storage_limit, 0);
    delete process.env.CLOUDINARY_API_SECRET;
    const res = mockResponse();

    await handler(sign(), res);

    expect(res.statusCode).toBe(500);
    expect(apiSignRequest).not.toHaveBeenCalled();
  });
});

describe('cloudinary: routing between the two actions', () => {
  it('answers 404 for a segment that is neither', async () => {
    const res = mockResponse();
    await handler(mockRequest({ query: { action: 'upload' }, body: {} }), res);
    expect(res.statusCode).toBe(404);
  });
});
