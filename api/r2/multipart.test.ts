import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockRequest, mockResponse, mockSupabase, type TableAnswer } from '../../lib/test-utils';
import { TIER_LIMITS } from '../../lib/tiers';
import { MAX_PARTS_PER_BATCH } from '../../lib/multipart';
import { PRESIGN_LIMIT, R2_PART_SIGN_LIMIT, resetRateLimits } from '../../lib/rate-limit';

const MB = 1024 * 1024;

const { FakeAuthError, authenticateUser, db, send, signedCommands } = vi.hoisted(() => ({
  FakeAuthError: class FakeAuthError extends Error {},
  authenticateUser: vi.fn(),
  db: { client: null as { from: (table: string) => unknown } | null },
  /** Every command the handler hands to R2 — the assertions read these rather
   *  than parsing a URL. */
  send: vi.fn(),
  signedCommands: [] as { input: Record<string, unknown> }[],
}));

vi.mock('../../lib/auth', () => ({
  AuthError: FakeAuthError,
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
  supabase: { from: (table: string) => db.client!.from(table) },
}));

vi.mock('../../lib/r2', () => ({
  getS3Client: () => ({ send }),
  getR2BucketName: () => 'test-bucket',
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (_client: unknown, command: { input: Record<string, unknown> }) => {
    signedCommands.push(command);
    return Promise.resolve(`https://r2.example/part-${command.input.PartNumber ?? 'x'}`);
  },
}));

import handler from './[action]';

const post = (action: string, body: Record<string, unknown>) =>
  mockRequest({ query: { action }, body });

/** A profile with room to spare, so quota is not what a test is measuring. */
function account(limit = TIER_LIMITS.pro.storage_limit, used = 0) {
  db.client = mockSupabase({
    profiles: { data: [{ storage_limit: limit, bytes_used: used }] } as TableAnswer,
    files: { data: [] } as TableAnswer,
  }).client;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  signedCommands.length = 0;
  authenticateUser.mockResolvedValue('user-1');
  send.mockResolvedValue({ UploadId: 'upload-1' });
  account();
});

describe('multipart-create', () => {
  it('opens an upload under the caller own prefix', async () => {
    const res = mockResponse();
    await handler(post('multipart-create', { fileName: 'movie.mp4', size: 200 * MB }), res);

    expect(res.statusCode).toBe(201);
    const { key, uploadId } = res.body as { key: string; uploadId: string };
    expect(key.startsWith('users/user-1/')).toBe(true);
    expect(uploadId).toBe('upload-1');
  });

  it('never lets the caller escape its own prefix through the file name', async () => {
    const res = mockResponse();
    await handler(post('multipart-create', { fileName: '../../escape.mp4', size: 200 * MB }), res);

    const { key } = res.body as { key: string };
    expect(key.startsWith('users/user-1/')).toBe(true);
    expect(key).not.toContain('..');
  });

  it('requires a file name and a size', async () => {
    const noName = mockResponse();
    await handler(post('multipart-create', { size: 200 * MB }), noName);
    expect(noName.statusCode).toBe(400);

    const noSize = mockResponse();
    await handler(post('multipart-create', { fileName: 'a.mp4' }), noSize);
    expect(noSize.statusCode).toBe(400);
  });

  it('refuses a file that would not fit, before anything is stored', async () => {
    account(TIER_LIMITS.free.storage_limit, 495 * MB);
    const res = mockResponse();
    await handler(post('multipart-create', { fileName: 'movie.mp4', size: 200 * MB }), res);

    expect(res.statusCode).toBe(413);
    expect(send).not.toHaveBeenCalled();
  });

  it('fails loudly when R2 answers without an upload id', async () => {
    // Signing parts against an undefined id produces URLs that 404 one by one,
    // which is a much worse way to find out.
    send.mockResolvedValue({});
    const res = mockResponse();
    await handler(post('multipart-create', { fileName: 'movie.mp4', size: 200 * MB }), res);

    expect(res.statusCode).toBe(500);
  });
});

describe('multipart-sign', () => {
  const sign = (body: Record<string, unknown>) =>
    post('multipart-sign', { key: 'users/user-1/movie.mp4', uploadId: 'upload-1', ...body });

  it('signs one URL per requested part', async () => {
    const res = mockResponse();
    await handler(sign({ partNumbers: [1, 2, 3] }), res);

    expect(res.statusCode).toBe(200);
    const { urls } = res.body as { urls: { partNumber: number; url: string }[] };
    expect(urls.map((u) => u.partNumber)).toEqual([1, 2, 3]);
    expect(signedCommands.map((c) => c.input.PartNumber)).toEqual([1, 2, 3]);
    expect(signedCommands.every((c) => c.input.UploadId === 'upload-1')).toBe(true);
  });

  it('refuses a key belonging to somebody else', async () => {
    const res = mockResponse();
    await handler(
      post('multipart-sign', {
        key: 'users/user-2/movie.mp4',
        uploadId: 'upload-1',
        partNumbers: [1],
      }),
      res
    );

    expect(res.statusCode).toBe(403);
    expect(signedCommands).toHaveLength(0);
  });

  it('is not fooled by a prefix that merely starts the same', async () => {
    const res = mockResponse();
    await handler(
      post('multipart-sign', {
        key: 'users/user-10/movie.mp4',
        uploadId: 'upload-1',
        partNumbers: [1],
      }),
      res
    );
    expect(res.statusCode).toBe(403);
  });

  it('caps how many parts one request may ask for', async () => {
    const res = mockResponse();
    const tooMany = Array.from({ length: MAX_PARTS_PER_BATCH + 1 }, (_, i) => i + 1);
    await handler(sign({ partNumbers: tooMany }), res);

    expect(res.statusCode).toBe(400);
    expect(signedCommands).toHaveLength(0);
  });

  it.each([
    ['empty', []],
    ['not an array', 'all of them'],
    ['zero', [0]],
    ['negative', [-1]],
    ['fractional', [1.5]],
    ['past the ceiling', [100_000]],
  ])('rejects part numbers that are %s', async (_label, partNumbers) => {
    const res = mockResponse();
    await handler(sign({ partNumbers }), res);
    expect(res.statusCode).toBe(400);
  });

  it('has a limit of its own, far above what one upload needs', async () => {
    // A file large enough to need every part this allows is still one request
    // per hundred parts — the ceiling is for a script, not for a big file.
    for (let i = 0; i < R2_PART_SIGN_LIMIT; i++) {
      await handler(sign({ partNumbers: [1] }), mockResponse());
    }

    const res = mockResponse();
    await handler(sign({ partNumbers: [1] }), res);
    expect(res.statusCode).toBe(429);
  });
});

describe('multipart-complete', () => {
  const complete = (body: Record<string, unknown>) =>
    post('multipart-complete', { key: 'users/user-1/movie.mp4', uploadId: 'upload-1', ...body });

  it('hands R2 the parts in order, whatever order they arrive in', async () => {
    // The browser uploads parts in parallel and they finish out of order;
    // CompleteMultipartUpload requires ascending part numbers.
    const res = mockResponse();
    await handler(
      complete({
        parts: [
          { partNumber: 3, etag: '"c"' },
          { partNumber: 1, etag: '"a"' },
          { partNumber: 2, etag: '"b"' },
        ],
      }),
      res
    );

    expect(res.statusCode).toBe(200);
    const command = send.mock.calls[0][0] as {
      input: { MultipartUpload: { Parts: { PartNumber: number; ETag: string }[] } };
    };
    expect(command.input.MultipartUpload.Parts).toEqual([
      { PartNumber: 1, ETag: '"a"' },
      { PartNumber: 2, ETag: '"b"' },
      { PartNumber: 3, ETag: '"c"' },
    ]);
  });

  it('refuses a key belonging to somebody else', async () => {
    const res = mockResponse();
    await handler(
      post('multipart-complete', {
        key: 'users/user-2/movie.mp4',
        uploadId: 'upload-1',
        parts: [{ partNumber: 1, etag: '"a"' }],
      }),
      res
    );

    expect(res.statusCode).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it('requires at least one part', async () => {
    const res = mockResponse();
    await handler(complete({ parts: [] }), res);
    expect(res.statusCode).toBe(400);
  });

  it('requires an etag on every part', async () => {
    const res = mockResponse();
    await handler(complete({ parts: [{ partNumber: 1 }] }), res);

    expect(res.statusCode).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('multipart-abort', () => {
  const abort = (key = 'users/user-1/movie.mp4') =>
    post('multipart-abort', { key, uploadId: 'upload-1' });

  it('releases the parts already stored', async () => {
    const res = mockResponse();
    await handler(abort(), res);

    expect(res.statusCode).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('refuses a key belonging to somebody else', async () => {
    const res = mockResponse();
    await handler(abort('users/user-2/movie.mp4'), res);

    expect(res.statusCode).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it('still works after the upload limit is spent', async () => {
    // Aborting is how the parts stop being billable. Refusing it because the
    // account uploaded too much is the one moment that costs real money — so
    // abort sits outside that limit. (The per-address guard in front of the
    // whole route still applies; it is an order of magnitude higher and exists
    // for callers with no token at all.)
    for (let i = 0; i <= PRESIGN_LIMIT; i++) {
      await handler(
        post('multipart-create', { fileName: 'a.mp4', size: 200 * MB }),
        mockResponse()
      );
    }

    const res = mockResponse();
    await handler(abort(), res);
    expect(res.statusCode).toBe(200);
  });
});

describe('the route itself', () => {
  it('answers 404 for a segment that names no action', async () => {
    const res = mockResponse();
    await handler(post('multipart-resume', {}), res);
    expect(res.statusCode).toBe(404);
  });

  it('refuses anything but POST', async () => {
    const res = mockResponse();
    await handler(mockRequest({ method: 'GET', query: { action: 'multipart-create' } }), res);
    expect(res.statusCode).toBe(405);
  });

  it('answers 401 when the caller is not authenticated', async () => {
    authenticateUser.mockRejectedValue(new FakeAuthError('no token'));
    const res = mockResponse();
    await handler(post('multipart-create', { fileName: 'a.mp4', size: 200 * MB }), res);

    expect(res.statusCode).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });
});
