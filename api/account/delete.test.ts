import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockRequest, mockResponse } from '../../lib/test-utils';
import type { EraseDeps } from '../../lib/account-erase';

const { FakeAuthError, authenticateUser, eraseAccount, send, deleteByPrefix, config } = vi.hoisted(
  () => ({
    FakeAuthError: class FakeAuthError extends Error {},
    authenticateUser: vi.fn(),
    eraseAccount: vi.fn(),
    send: vi.fn(),
    deleteByPrefix: vi.fn(),
    config: vi.fn(),
  })
);

vi.mock('../../lib/auth', () => ({
  AuthError: FakeAuthError,
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
  supabase: {},
}));

vi.mock('../../lib/account-erase', () => ({
  eraseAccount: (...args: unknown[]) => eraseAccount(...args),
}));

vi.mock('../../lib/r2', () => ({
  getS3Client: () => ({ send }),
  getR2BucketName: () => 'test-bucket',
}));

vi.mock('cloudinary', () => ({
  v2: { config, api: { delete_resources_by_prefix: deleteByPrefix } },
}));

import handler from './delete';

/* The limiter allows five an hour and keys on the client IP, which is
   `'unknown'` for every request that carries no `x-forwarded-for`. Sharing one
   key across a file means the sixth DELETE gets a 429 whatever it was testing:
   a failure that moves as tests are added. One address per test, for the same
   reason the e2e suite gives every test its own account. */
let addresses = 0;
function request(overrides: Partial<Parameters<typeof mockRequest>[0]> = {}) {
  addresses += 1;
  return mockRequest({
    method: 'DELETE',
    ...overrides,
    headers: { authorization: 'Bearer t', 'x-forwarded-for': `203.0.113.${addresses}` },
  });
}

/** The providers the handler decided to erase with, as it passed them along. */
const depsUsed = () => eraseAccount.mock.calls[0]![1] as Omit<EraseDeps, 'supabase'>;

const commands = (name: string) =>
  send.mock.calls.map((c) => c[0]).filter((c) => c.constructor.name === name);

function withR2() {
  vi.stubEnv('R2_ENDPOINT', 'https://r2.test');
  vi.stubEnv('R2_BUCKET_NAME', 'bucket');
}

function withCloudinary() {
  vi.stubEnv('CLOUDINARY_CLOUD_NAME', 'demo-cloud');
  vi.stubEnv('CLOUDINARY_API_KEY', 'key');
  vi.stubEnv('CLOUDINARY_API_SECRET', 'secret');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  authenticateUser.mockResolvedValue('user-1');
  eraseAccount.mockResolvedValue({ failures: [] });
  send.mockResolvedValue({ Contents: [], IsTruncated: false });
  deleteByPrefix.mockResolvedValue({});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('account deletion', () => {
  it('refuses a method that is not DELETE or POST', async () => {
    const res = mockResponse();
    await handler(mockRequest({ method: 'GET' }), res);
    expect(res.statusCode).toBe(405);
    expect(eraseAccount).not.toHaveBeenCalled();
  });

  it('answers 401 when the caller is not authenticated', async () => {
    authenticateUser.mockRejectedValue(new FakeAuthError('no token'));
    const res = mockResponse();
    await handler(request(), res);
    expect(res.statusCode).toBe(401);
    expect(eraseAccount).not.toHaveBeenCalled();
  });

  /* The id comes from the verified token, never from the body — otherwise this
     route would delete any account whose id a caller could guess. */
  it('erases the account the token names, not one the body asks for', async () => {
    const res = mockResponse();
    await handler(request({ body: { userId: 'someone-else' } }), res);

    expect(res.statusCode).toBe(200);
    expect(eraseAccount.mock.calls[0]![0]).toBe('user-1');
  });

  it('reports the providers that could not be reached, and still says deleted', async () => {
    eraseAccount.mockResolvedValue({ failures: ['r2'] });
    const res = mockResponse();
    await handler(request(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ deleted: true, failures: ['r2'] });
  });

  it('answers 500 when the account itself could not be deleted', async () => {
    eraseAccount.mockRejectedValue(new Error('Failed to delete the account: nope'));
    const res = mockResponse();
    await handler(request(), res);
    expect(res.statusCode).toBe(500);
  });

  it('refuses a sixth attempt from one address within the hour', async () => {
    const attacker = { headers: { authorization: 'Bearer t', 'x-forwarded-for': '198.51.100.7' } };
    for (let i = 0; i < 5; i += 1) {
      await handler(mockRequest({ method: 'DELETE', ...attacker }), mockResponse());
    }

    const res = mockResponse();
    await handler(mockRequest({ method: 'DELETE', ...attacker }), res);

    expect(res.statusCode).toBe(429);
    expect(eraseAccount).toHaveBeenCalledTimes(5);
  });
});

/* An unconfigured provider is left out rather than made to fail: a deployment
   with no R2 has no R2 objects and must still delete the account. The risk runs
   the other way too — a configured provider left out is bytes that survive a
   deletion the law required, with `failures` empty because nothing was tried. */
describe('which providers the erase is given', () => {
  it('leaves both out when neither is configured, and still deletes', async () => {
    for (const k of ['R2_ENDPOINT', 'CLOUDINARY_CLOUD_NAME', 'VITE_CLOUDINARY_CLOUD_NAME']) {
      vi.stubEnv(k, '');
    }

    const res = mockResponse();
    await handler(request(), res);

    expect(res.statusCode).toBe(200);
    expect(depsUsed().eraseR2).toBeUndefined();
    expect(depsUsed().eraseCloudinary).toBeUndefined();
  });

  it('includes each provider once it is fully configured', async () => {
    withR2();
    withCloudinary();

    await handler(request(), mockResponse());

    expect(depsUsed().eraseR2).toBeTypeOf('function');
    expect(depsUsed().eraseCloudinary).toBeTypeOf('function');
    expect(config).toHaveBeenCalledWith({
      cloud_name: 'demo-cloud',
      api_key: 'key',
      api_secret: 'secret',
    });
  });

  /* Half a credential set would configure the SDK anyway and fail on the first
     call, reported as a provider failure rather than as a deployment that never
     had Cloudinary at all. */
  it('leaves Cloudinary out when one of the three is missing', async () => {
    withCloudinary();
    vi.stubEnv('CLOUDINARY_API_SECRET', '');

    await handler(request(), mockResponse());

    expect(depsUsed().eraseCloudinary).toBeUndefined();
    expect(config).not.toHaveBeenCalled();
  });
});

/* The objects are listed from the bucket rather than derived from `files`, so
   that an upload which half-failed does not leave bytes behind — which also
   means nothing else in the system would notice if this stopped after one
   page. */
describe('erasing R2', () => {
  const page = (keys: string[], next?: string) => ({
    Contents: keys.map((Key) => ({ Key })),
    IsTruncated: Boolean(next),
    NextContinuationToken: next,
  });

  async function eraseFor(userId: string) {
    withR2();
    await handler(request(), mockResponse());
    const { eraseR2 } = depsUsed();
    send.mockClear();
    await eraseR2!(userId);
  }

  it('lists only under the account being erased', async () => {
    await eraseFor('user-9');

    expect(commands('ListObjectsV2Command')[0].input).toMatchObject({
      Bucket: 'test-bucket',
      Prefix: 'users/user-9/',
    });
  });

  /* A truncated first page with the second never asked for is a deletion that
     reports success and leaves the account's files in the bucket. */
  it('follows the continuation token to the end', async () => {
    send
      .mockResolvedValueOnce(page(['users/user-1/a'], 'page-2'))
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(page(['users/user-1/b']))
      .mockResolvedValueOnce({});

    await eraseFor('user-1');

    const lists = commands('ListObjectsV2Command');
    expect(lists).toHaveLength(2);
    expect(lists[1].input.ContinuationToken).toBe('page-2');

    const deleted = commands('DeleteObjectsCommand').flatMap((c) =>
      c.input.Delete.Objects.map((o: { Key: string }) => o.Key)
    );
    expect(deleted).toEqual(['users/user-1/a', 'users/user-1/b']);
  });

  /* S3 refuses a delete of more than 1000 keys outright, so an account over
     that is where a single unbatched call would start failing. */
  it('splits a page into requests of at most 1000 keys', async () => {
    send.mockResolvedValue(page(Array.from({ length: 1001 }, (_, i) => `users/user-1/f${i}`)));

    await eraseFor('user-1');

    const batches = commands('DeleteObjectsCommand');
    expect(batches.map((c) => c.input.Delete.Objects.length)).toEqual([1000, 1]);
  });
});

/* Images and raw files are separate namespaces in Cloudinary, and asking for
   one is a deletion that silently keeps the other. */
describe('erasing Cloudinary', () => {
  it('deletes both resource types under the account prefix', async () => {
    withCloudinary();
    await handler(request(), mockResponse());
    const { eraseCloudinary } = depsUsed();
    deleteByPrefix.mockClear();

    await eraseCloudinary!('user-4');

    expect(deleteByPrefix.mock.calls).toEqual([
      ['users/user-4/', { resource_type: 'image' }],
      ['users/user-4/', { resource_type: 'raw' }],
    ]);
  });
});
