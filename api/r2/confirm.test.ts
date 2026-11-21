import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import {
  mockRequest,
  mockResponse,
  mockSupabase,
  type TableAnswer,
} from '../../libs/server/src/test-utils';
import { PRESIGN_LIMIT, resetRateLimits } from '../../libs/server/src/rate-limit';

const MB = 1024 * 1024;

const { FakeAuthError, authenticateUser, db, send, report } = vi.hoisted(() => ({
  FakeAuthError: class FakeAuthError extends Error {},
  authenticateUser: vi.fn(),
  db: { client: null as { from: (table: string) => unknown } | null },
  send: vi.fn(),
  report: vi.fn(),
}));

vi.mock('../../libs/server/src/report', () => ({
  report: (...args: unknown[]) => report(...args),
}));

vi.mock('../../libs/server/src/auth', () => ({
  AuthError: FakeAuthError,
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
  supabase: { from: (table: string) => db.client!.from(table) },
}));

vi.mock('../../libs/server/src/r2', () => ({
  getS3Client: () => ({ send }),
  getR2BucketName: () => 'test-bucket',
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: () => Promise.resolve('https://r2.example/large.bin?signature=x'),
}));

import handler from './[action]';

const KEY = 'users/user-1/1700000000_large.bin';

const confirm = (body: Record<string, unknown> = {}) =>
  mockRequest({
    query: { action: 'confirm' },
    body: {
      key: KEY,
      name: 'large.bin',
      type: 'application/octet-stream',
      folderId: null,
      ...body,
    },
  });

/** R2 holds an object of `size` bytes at the key, and deletes what it is told to. */
function r2Holds(size: number) {
  send.mockImplementation((command: unknown) => {
    if (command instanceof HeadObjectCommand) return Promise.resolve({ ContentLength: size });
    return Promise.resolve({});
  });
}

const deleted = () =>
  send.mock.calls.some(
    ([command]) => command instanceof DeleteObjectCommand && command.input.Key === KEY
  );

function recorded(mock: ReturnType<typeof mockSupabase>) {
  return mock.calls.find((call) => call.table === 'files' && call.op === 'insert')?.args?.[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  authenticateUser.mockResolvedValue('user-1');
  r2Holds(40 * MB);
  db.client = mockSupabase({ files: { data: [{ id: 'f1' }] } }).client;
});

describe('r2 confirm: the server weighs an upload and records it', () => {
  it('records the size R2 holds, not one the browser names', async () => {
    const mock = mockSupabase({ files: { data: [{ id: 'f1', size: 40 * MB }] } });
    db.client = mock.client;
    const res = mockResponse();

    await handler(confirm({ size: 1 }), res);

    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ id: 'f1' });
    expect(recorded(mock)).toMatchObject({
      size: 40 * MB,
      storage_type: 'r2',
      storage_path: KEY,
      user_id: 'user-1',
      name: 'large.bin',
    });
    expect(deleted()).toBe(false);
  });

  it('refuses a key belonging to somebody else, before asking R2', async () => {
    const res = mockResponse();

    await handler(confirm({ key: 'users/user-2/1700000000_large.bin' }), res);

    expect(res.statusCode).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it('deletes the object and answers 413 when the bytes do not fit', async () => {
    db.client = mockSupabase({
      files: { error: { message: 'Storage limit exceeded', code: 'PT413' } } as TableAnswer,
      profiles: { data: [{ storage_limit: 10 * MB, bytes_used: 0 }] } as TableAnswer,
    }).client;
    const res = mockResponse();

    await handler(confirm(), res);

    expect(res.statusCode).toBe(413);
    expect(res.body).toMatchObject({ message: expect.stringContaining('Storage limit exceeded') });
    expect(deleted()).toBe(true);
  });

  it('deletes the object and answers 400 when the folder is not the caller own', async () => {
    db.client = mockSupabase({
      files: { error: { message: 'violates foreign key', code: '23503' } } as TableAnswer,
    }).client;
    const res = mockResponse();

    await handler(confirm({ folderId: '3f2b8c1e-4d5a-4e6f-8a9b-0c1d2e3f4a5b' }), res);

    expect(res.statusCode).toBe(400);
    expect(deleted()).toBe(true);
  });

  it('answers 404, and records nothing, for an object R2 does not hold', async () => {
    send.mockImplementation((command: unknown) =>
      command instanceof HeadObjectCommand
        ? Promise.reject(Object.assign(new Error('NotFound'), { name: 'NotFound' }))
        : Promise.resolve({})
    );
    const mock = mockSupabase({});
    db.client = mock.client;
    const res = mockResponse();

    await handler(confirm(), res);

    expect(res.statusCode).toBe(404);
    expect(recorded(mock)).toBeUndefined();
  });

  it('requires a key and a name', async () => {
    const noKey = mockResponse();
    await handler(confirm({ key: undefined }), noKey);
    expect(noKey.statusCode).toBe(400);

    const noName = mockResponse();
    await handler(confirm({ name: undefined }), noName);
    expect(noName.statusCode).toBe(400);

    expect(send).not.toHaveBeenCalled();
  });

  it('counts confirming apart from presigning, so an upload is not charged twice', async () => {
    db.client = mockSupabase({
      profiles: { data: [{ storage_limit: 10_000 * MB, bytes_used: 0 }] } as TableAnswer,
    }).client;
    for (let i = 0; i < PRESIGN_LIMIT; i++) {
      await handler(
        mockRequest({ query: { action: 'presign-upload' }, body: { fileName: 'a.bin', size: 1 } }),
        mockResponse()
      );
    }

    db.client = mockSupabase({ files: { data: [{ id: 'f1' }] } }).client;
    const res = mockResponse();
    await handler(confirm(), res);

    expect(res.statusCode).toBe(201);
  });

  it('still answers 413 when deleting the unrecorded object fails, and reports that', async () => {
    send.mockImplementation((command: unknown) => {
      if (command instanceof HeadObjectCommand) return Promise.resolve({ ContentLength: 40 * MB });
      if (command instanceof DeleteObjectCommand) return Promise.reject(new Error('delete failed'));
      return Promise.resolve({});
    });
    db.client = mockSupabase({
      files: { error: { message: 'Storage limit exceeded', code: 'PT413' } } as TableAnswer,
      profiles: { data: [{ storage_limit: 10 * MB, bytes_used: 0 }] } as TableAnswer,
    }).client;
    const res = mockResponse();

    await handler(confirm(), res);

    expect(res.statusCode).toBe(413);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'delete failed' }),
      expect.objectContaining({ route: 'r2/confirm' })
    );
  });
});
