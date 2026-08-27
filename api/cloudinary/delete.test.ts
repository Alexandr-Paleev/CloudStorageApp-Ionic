import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockRequest, mockResponse, mockSupabase, type TableAnswer } from '../../lib/test-utils';

const { FakeAuthError, authenticateUser, db, destroy, config } = vi.hoisted(() => ({
  FakeAuthError: class FakeAuthError extends Error {},
  authenticateUser: vi.fn(),
  db: { client: null as { from: (table: string) => unknown } | null },
  destroy: vi.fn(),
  config: vi.fn(),
}));

vi.mock('../../lib/auth', () => ({
  AuthError: FakeAuthError,
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
  supabase: { from: (table: string) => db.client!.from(table) },
}));

vi.mock('cloudinary', () => ({
  v2: { config, uploader: { destroy } },
}));

import handler from './delete';

function withFiles(rows: { storage_path: string }[]) {
  db.client = mockSupabase({ files: { data: rows } as TableAnswer }).client;
}

function del(publicId?: string, resourceType?: string) {
  return mockRequest({ body: { publicId, resourceType } });
}

beforeEach(() => {
  vi.clearAllMocks();
  authenticateUser.mockResolvedValue('user-1');
  withFiles([]);
  destroy.mockResolvedValue({ result: 'ok' });
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
