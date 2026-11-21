import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  mockRequest,
  mockResponse,
  mockSupabase,
  type TableAnswer,
} from '../../libs/server/src/test-utils';
import { TIER_LIMITS } from '../../libs/core/src/tiers';
import {
  CLOUDINARY_DELETE_LIMIT,
  CLOUDINARY_IP_LIMIT,
  CLOUDINARY_SIGN_LIMIT,
  resetRateLimits,
} from '../../libs/server/src/rate-limit';

const { FakeAuthError, authenticateUser, db, destroy, resource, config, apiSignRequest, report } =
  vi.hoisted(() => ({
    FakeAuthError: class FakeAuthError extends Error {},
    authenticateUser: vi.fn(),
    db: { client: null as { from: (table: string) => unknown } | null },
    destroy: vi.fn(),
    resource: vi.fn(),
    config: vi.fn(),
    apiSignRequest: vi.fn((_params: Record<string, unknown>, _secret: string) => 'the-signature'),
    report: vi.fn(),
  }));

vi.mock('../../libs/server/src/auth', () => ({
  AuthError: FakeAuthError,
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
  supabase: { from: (table: string) => db.client!.from(table) },
}));

vi.mock('cloudinary', () => ({
  v2: {
    config,
    uploader: { destroy },
    api: { resource: (...args: unknown[]) => resource(...args) },
    utils: {
      api_sign_request: (params: Record<string, unknown>, secret: string) =>
        apiSignRequest(params, secret),
    },
  },
}));

vi.mock('../../libs/server/src/report', () => ({
  report: (...args: unknown[]) => report(...args),
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
  // Module-scope singletons: without this, what one test spends against a
  // limit stays spent in the next.
  resetRateLimits();
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

  it('is not talked into it by a row the caller wrote themselves', async () => {
    // The hole this closes: `files` rows are written by the browser, so a caller
    // could store another account's public_id — it is in every delivery URL,
    // shared links included — in a row of their own, and a fallback that read
    // the rows took that as proof of ownership. The route reads no rows now;
    // this one is here on purpose, so the test fails if such a fallback returns.
    withFiles([{ storage_path: 'users/user-2/their-photo.jpg' }]);
    const res = mockResponse();
    await handler(del('users/user-2/their-photo'), res);

    expect(res.statusCode).toBe(403);
    expect(destroy).not.toHaveBeenCalled();
  });

  it("refuses an id outside the folder convention, whatever the caller's rows say", async () => {
    // Dynamic-folder public_ids carry no users/<id>/ prefix, and used to be
    // matched against the rows instead. A visible 403 on such an account is the
    // price of nobody being able to delete what they do not own.
    withFiles([{ storage_path: 'legacy-asset-42' }]);
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

  it('tries the other endpoint when the named one has nothing', async () => {
    // Rows written before uploads were signed went through Cloudinary's
    // `auto`, which chose the endpoint for itself — so the type recorded on
    // the row is a good guess, not a guarantee, in both directions.
    destroy.mockResolvedValue({ result: 'not found' });
    const res = mockResponse();
    await handler(del('users/user-1/doc', 'raw'), res);

    expect(destroy).toHaveBeenCalledTimes(2);
    expect(destroy.mock.calls[0]![1]).toMatchObject({ resource_type: 'raw' });
    expect(destroy.mock.calls[1]![1]).toMatchObject({ resource_type: 'image' });
    expect(res.statusCode).toBe(200);
  });

  it('reports a genuine Cloudinary failure as 500', async () => {
    destroy.mockResolvedValue({ result: 'error' });
    const res = mockResponse();
    await handler(del('users/user-1/photo', 'image'), res);

    expect(res.statusCode).toBe(500);
  });

  /* One function, two actions: Sentry is told which of them failed. */
  it('tells Sentry a failure by the action it happened in', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    destroy.mockRejectedValue({ message: 'Rate Limit Exceeded', http_code: 420 });
    await handler(del('users/user-1/photo', 'image'), mockResponse());

    expect(report).toHaveBeenCalledWith(
      { message: 'Rate Limit Exceeded', http_code: 420 },
      { route: 'cloudinary/delete' }
    );
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
      resourceType: 'image',
    });
  });

  it('signs exactly the parameters it hands back, and nothing else', async () => {
    // Cloudinary rejects the upload if the signed set and the sent set differ,
    // and an over-broad signature would let the client change what it sends.
    account(TIER_LIMITS.free.storage_limit, 0);
    const res = mockResponse();

    await handler(sign(), res);

    const [params, secret] = apiSignRequest.mock.calls[0]!;
    expect(Object.keys(params).sort()).toEqual([
      'folder',
      'overwrite',
      'public_id',
      'tags',
      'timestamp',
    ]);
    expect(secret).toBe('test-secret');
    expect(res.body).toMatchObject({
      timestamp: params.timestamp,
      public_id: params.public_id,
      overwrite: false,
    });
  });

  /* One signature took as many files as were sent with it while Cloudinary
     named them: two different files, on production on 2026-10-23. Named here,
     with overwrite off, a second upload with it finds the first and keeps it. */
  it('names each upload, so that one signature buys one file', async () => {
    account(TIER_LIMITS.free.storage_limit, 0);
    const first = mockResponse();
    const second = mockResponse();

    await handler(sign(), first);
    await handler(sign(), second);

    const a = first.body as { public_id: string; overwrite: boolean };
    const b = second.body as { public_id: string; overwrite: boolean };
    expect(a.public_id).toMatch(/^[0-9a-f]{32}$/);
    expect(b.public_id).not.toBe(a.public_id);
    expect(a.overwrite).toBe(false);
  });

  it("keeps a raw file's extension in its name, as Cloudinary's own names do", async () => {
    account(TIER_LIMITS.free.storage_limit, 0);
    const raw = mockResponse();
    const image = mockResponse();

    await handler(sign({ fileName: 'Notes.TXT', contentType: 'text/plain' }), raw);
    await handler(sign({ fileName: 'photo.png', contentType: 'image/png' }), image);

    expect((raw.body as { public_id: string }).public_id).toMatch(/^[0-9a-f]{32}\.txt$/);
    expect((image.body as { public_id: string }).public_id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('never lets the caller name the file, or overwrite one', async () => {
    account(TIER_LIMITS.free.storage_limit, 0);
    const res = mockResponse();

    await handler(sign({ public_id: 'somebody-elses', overwrite: true }), res);

    expect(res.body).toMatchObject({ overwrite: false });
    expect((res.body as { public_id: string }).public_id).not.toBe('somebody-elses');
  });

  it('never lets the caller name the folder it uploads into', async () => {
    account(TIER_LIMITS.free.storage_limit, 0);
    const res = mockResponse();

    await handler(sign({ folder: 'users/someone-else', tags: 'user_someone-else' }), res);

    expect(res.body).toMatchObject({ folder: 'users/user-1', tags: 'user_user-1' });
  });

  it.each([
    ['report.pdf', 'application/pdf'],
    ['notes.txt', 'text/plain'],
    ['archive.zip', 'application/zip'],
  ])('sends %s to the raw endpoint, where the delete path looks for it', async (name, type) => {
    // Anything that is not an image is raw. `auto` would decide for itself,
    // and CloudinaryProvider.delete has to reproduce that decision from the
    // stored row months later — a .txt guessed wrong is an asset that stays
    // in the account after its row is gone.
    account(TIER_LIMITS.free.storage_limit, 0);
    const res = mockResponse();

    await handler(sign({ fileName: name, contentType: type }), res);

    expect(res.body).toMatchObject({ resourceType: 'raw' });
  });

  it('falls back to the file name when the browser reports no type at all', async () => {
    // The browser sends '' — not undefined — for a type it cannot work out,
    // and '' is a string, so the previous `??` never reached this branch: a
    // .jpg was being signed for the raw endpoint and could not be deleted.
    account(TIER_LIMITS.free.storage_limit, 0);
    const res = mockResponse();

    await handler(sign({ fileName: 'holiday.jpg', contentType: '' }), res);

    expect(res.body).toMatchObject({ resourceType: 'image' });
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

  it('answers 501 when the server has no Cloudinary secret', async () => {
    // Not 500: the client cannot see the server's variables, so isConfigured()
    // keeps routing images here on a half-configured deployment. 501 tells the
    // retry helper this will never come good — see isRetriableError.
    account(TIER_LIMITS.free.storage_limit, 0);
    delete process.env.CLOUDINARY_API_SECRET;
    const res = mockResponse();

    await handler(sign(), res);

    expect(res.statusCode).toBe(501);
    expect(apiSignRequest).not.toHaveBeenCalled();
  });
});

describe('cloudinary delete: the resource type is not taken as given', () => {
  it('refuses one Cloudinary has no endpoint for', async () => {
    // It is interpolated into the path the API is called on.
    const res = mockResponse();
    await handler(del('users/user-1/photo', '../../admin'), res);

    expect(res.statusCode).toBe(400);
    expect(destroy).not.toHaveBeenCalled();
  });

  it.each(['image', 'raw', 'video'])('accepts %s', async (type) => {
    const res = mockResponse();
    await handler(del('users/user-1/photo', type), res);

    expect(res.statusCode).toBe(200);
  });
});

describe('cloudinary: routing between the two actions', () => {
  it('answers 404 for a segment that is neither', async () => {
    const res = mockResponse();
    await handler(mockRequest({ query: { action: 'upload' }, body: {} }), res);
    expect(res.statusCode).toBe(404);
  });
});

describe('cloudinary: rate limiting', () => {
  /** A request from a named address, so the per-address limit is isolated. */
  const from = (ip: string, query: Record<string, string>, body: Record<string, unknown> = {}) =>
    mockRequest({ query, body, headers: { authorization: 'Bearer t', 'x-forwarded-for': ip } });

  it('stops signing uploads once the account has asked too often', async () => {
    account(TIER_LIMITS.pro.storage_limit, 0);
    for (let i = 0; i < CLOUDINARY_SIGN_LIMIT; i++) {
      const ok = mockResponse();
      await handler(sign(), ok);
      expect(ok.statusCode).toBe(200);
    }

    const res = mockResponse();
    await handler(sign(), res);

    expect(res.statusCode).toBe(429);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.stringMatching(/^[1-9]\d*$/));
  });

  it('lets the account keep deleting after the signing limit is spent', async () => {
    // The two actions do opposite things to the quota, so one running out says
    // nothing about the other — and clearing space is how a full account
    // recovers.
    account(TIER_LIMITS.pro.storage_limit, 0);
    for (let i = 0; i <= CLOUDINARY_SIGN_LIMIT; i++) {
      await handler(sign(), mockResponse());
    }

    const res = mockResponse();
    await handler(del('users/user-1/photo'), res);

    expect(res.statusCode).toBe(200);
  });

  it('stops deleting once the account has asked too often', async () => {
    // Each one is a call to Cloudinary's own API, against a limit of its own.
    for (let i = 0; i < CLOUDINARY_DELETE_LIMIT; i++) {
      await handler(del('users/user-1/photo'), mockResponse());
    }

    destroy.mockClear();
    const res = mockResponse();
    await handler(del('users/user-1/photo'), res);

    expect(res.statusCode).toBe(429);
    expect(destroy).not.toHaveBeenCalled();
  });

  it('charges the account, not the address it shares with an office', async () => {
    account(TIER_LIMITS.pro.storage_limit, 0);
    for (let i = 0; i < CLOUDINARY_SIGN_LIMIT; i++) {
      await handler(sign(), mockResponse());
    }

    authenticateUser.mockResolvedValue('user-2');
    const res = mockResponse();
    await handler(sign(), res);

    expect(res.statusCode).toBe(200);
  });

  it('caps an address before it validates a token', async () => {
    for (let i = 0; i < CLOUDINARY_IP_LIMIT; i++) {
      await handler(
        from('203.0.113.9', { action: 'delete' }, { publicId: 'users/user-1/x' }),
        mockResponse()
      );
    }

    authenticateUser.mockClear();
    const res = mockResponse();
    await handler(from('203.0.113.9', { action: 'delete' }, { publicId: 'users/user-1/x' }), res);

    expect(res.statusCode).toBe(429);
    expect(authenticateUser).not.toHaveBeenCalled();
  });

  it('does not let an unknown action eat into the limit of the one it misspells', async () => {
    for (let i = 0; i < CLOUDINARY_DELETE_LIMIT; i++) {
      await handler(mockRequest({ query: { action: 'delet' }, body: {} }), mockResponse());
    }

    const res = mockResponse();
    await handler(del('users/user-1/photo'), res);

    expect(res.statusCode).toBe(200);
  });
});

describe('cloudinary confirm: the server weighs an upload and records it', () => {
  const ASSET = 'users/user-1/abc123';

  function confirm(body: Record<string, unknown> = {}) {
    return mockRequest({
      query: { action: 'confirm' },
      body: {
        publicId: ASSET,
        resourceType: 'image',
        name: 'photo.png',
        type: 'image/png',
        folderId: null,
        ...body,
      },
    });
  }

  function recorded(mock: ReturnType<typeof mockSupabase>) {
    return mock.calls.find((call) => call.table === 'files' && call.op === 'insert')?.args?.[0];
  }

  beforeEach(() => {
    resource.mockResolvedValue({
      bytes: 40_000_000,
      secure_url: 'https://res.cloudinary.com/test-cloud/image/upload/abc123.png',
    });
  });

  it('records the size Cloudinary holds, not one the browser names', async () => {
    const mock = mockSupabase({ files: { data: [{ id: 'f1', size: 40_000_000 }] } });
    db.client = mock.client;
    const res = mockResponse();

    await handler(confirm({ size: 1 }), res);

    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ id: 'f1' });
    expect(resource).toHaveBeenCalledWith(ASSET, { resource_type: 'image' });
    expect(recorded(mock)).toMatchObject({
      size: 40_000_000,
      storage_type: 'cloudinary',
      storage_path: ASSET,
      download_url: 'https://res.cloudinary.com/test-cloud/image/upload/abc123.png',
      user_id: 'user-1',
      name: 'photo.png',
    });
    expect(destroy).not.toHaveBeenCalled();
  });

  it('refuses an asset outside the caller own folder, before asking Cloudinary', async () => {
    const res = mockResponse();

    await handler(confirm({ publicId: 'users/user-2/abc123' }), res);

    expect(res.statusCode).toBe(403);
    expect(resource).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
  });

  it('destroys the asset and answers 413 when the bytes do not fit', async () => {
    db.client = mockSupabase({
      files: { error: { message: 'Storage limit exceeded', code: 'PT413' } } as TableAnswer,
      profiles: { data: [{ storage_limit: 10_000_000, bytes_used: 0 }] } as TableAnswer,
    }).client;
    const res = mockResponse();

    await handler(confirm(), res);

    expect(res.statusCode).toBe(413);
    expect(res.body).toMatchObject({ message: expect.stringContaining('Storage limit exceeded') });
    expect(destroy).toHaveBeenCalledWith(ASSET, { resource_type: 'image' });
  });

  it('destroys the asset and answers 400 when the folder is not the caller own', async () => {
    db.client = mockSupabase({
      files: { error: { message: 'violates foreign key', code: '23503' } } as TableAnswer,
    }).client;
    const res = mockResponse();

    await handler(confirm({ folderId: '3f2b8c1e-4d5a-4e6f-8a9b-0c1d2e3f4a5b' }), res);

    expect(res.statusCode).toBe(400);
    expect(destroy).toHaveBeenCalledWith(ASSET, { resource_type: 'image' });
  });

  it('answers 404, and records nothing, for an asset Cloudinary does not hold', async () => {
    resource.mockRejectedValue({ error: { http_code: 404, message: 'Resource not found' } });
    const mock = mockSupabase({});
    db.client = mock.client;
    const res = mockResponse();

    await handler(confirm(), res);

    expect(res.statusCode).toBe(404);
    expect(recorded(mock)).toBeUndefined();
  });

  it("destroys what it cannot weigh once the hour's Admin API requests are spent", async () => {
    resource.mockRejectedValue({ error: { http_code: 420, message: 'Rate Limit Exceeded' } });
    const mock = mockSupabase({});
    db.client = mock.client;
    const res = mockResponse();

    await handler(confirm(), res);

    expect(res.statusCode).toBe(503);
    expect(destroy).toHaveBeenCalledWith(ASSET, { resource_type: 'image' });
    expect(recorded(mock)).toBeUndefined();
  });

  it.each([
    [{ publicId: undefined }, 'publicId is required'],
    [{ resourceType: 'video' }, 'resourceType must be image or raw'],
    [{ name: '' }, 'name is required'],
  ])('refuses a body that cannot be a row: %j', async (body, message) => {
    const res = mockResponse();

    await handler(confirm(body), res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ message });
    expect(resource).not.toHaveBeenCalled();
  });

  it('answers 501 when the server has no Cloudinary secret', async () => {
    delete process.env.CLOUDINARY_API_SECRET;
    const res = mockResponse();

    await handler(confirm(), res);

    expect(res.statusCode).toBe(501);
  });

  it('counts confirming apart from signing, so an upload is not charged twice', async () => {
    account(TIER_LIMITS.pro.storage_limit, 0);
    for (let i = 0; i < CLOUDINARY_SIGN_LIMIT; i++) await handler(sign(), mockResponse());

    db.client = mockSupabase({ files: { data: [{ id: 'f1' }] } }).client;
    const res = mockResponse();
    await handler(confirm(), res);

    expect(res.statusCode).toBe(201);
  });
});

describe('cloudinary confirm: what a failure may say', () => {
  const ASSET = 'users/user-1/abc123';
  const confirm = () =>
    mockRequest({
      query: { action: 'confirm' },
      body: { publicId: ASSET, resourceType: 'image', name: 'photo.png', type: 'image/png' },
    });

  /* The SDK rejects a failed Admin API call with the request it made. Its
     `auth` is the key and the secret unless `hide_sensitive` is set, and the
     function writes what it catches to the console, which Vercel keeps. */
  it('tells Cloudinary to leave the secret out of a rejection', async () => {
    resource.mockResolvedValue({ bytes: 1, secure_url: 'https://res.cloudinary.com/x' });
    db.client = mockSupabase({ files: { data: [{ id: 'f1' }] } }).client;

    await handler(confirm(), mockResponse());

    expect(config).toHaveBeenCalledWith(expect.objectContaining({ hide_sensitive: true }));
  });

  it('logs and reports an unexpected Admin API failure without the request in it', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    resource.mockRejectedValue({
      error: { http_code: 500, message: 'General Error' },
      request_options: { auth: 'test-key:test-secret' },
    });
    const res = mockResponse();

    await handler(confirm(), res);

    expect(res.statusCode).toBe(500);
    const logged = JSON.stringify(consoleError.mock.calls, (_key, value) =>
      value instanceof Error ? value.message : value
    );
    expect(logged).toContain('General Error');
    expect(logged).not.toContain('test-secret');
    const reported = report.mock.calls.map(([error]) => (error as Error).message).join(' ');
    expect(reported).toContain('General Error');
    expect(reported).not.toContain('test-secret');
    consoleError.mockRestore();
  });

  it('still answers 413 when destroying the unrecorded asset fails, and reports that', async () => {
    resource.mockResolvedValue({ bytes: 40_000_000, secure_url: 'https://res.cloudinary.com/x' });
    destroy.mockRejectedValue({ error: { http_code: 500, message: 'destroy failed' } });
    db.client = mockSupabase({
      files: { error: { message: 'Storage limit exceeded', code: 'PT413' } } as TableAnswer,
      profiles: { data: [{ storage_limit: 10_000_000, bytes_used: 0 }] } as TableAnswer,
    }).client;
    const res = mockResponse();

    await handler(confirm(), res);

    expect(res.statusCode).toBe(413);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('destroy failed') }),
      expect.objectContaining({ route: 'cloudinary/confirm' })
    );
  });

  it("tells the owner when the hour's Admin API requests are spent", async () => {
    resource.mockRejectedValue({ error: { http_code: 420, message: 'Rate Limit Exceeded' } });

    await handler(confirm(), mockResponse());

    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Admin API limit') }),
      expect.objectContaining({ route: 'cloudinary/confirm' })
    );
  });
});
