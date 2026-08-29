import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockRequest, mockResponse } from '../../lib/test-utils';

const { FakeAuthError, authenticateUser, send } = vi.hoisted(() => ({
  FakeAuthError: class FakeAuthError extends Error {},
  authenticateUser: vi.fn(),
  send: vi.fn(),
}));

vi.mock('../../lib/auth', () => ({
  AuthError: FakeAuthError,
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
  supabase: {},
}));

vi.mock('../../lib/r2', () => ({
  getS3Client: () => ({ send }),
  getR2BucketName: () => 'bucket',
}));

import handler from './delete';

const del = (key?: string) => mockRequest({ body: { key } });

beforeEach(() => {
  vi.clearAllMocks();
  authenticateUser.mockResolvedValue('user-1');
  send.mockResolvedValue({});
});

describe('r2 delete', () => {
  it('refuses anything but POST', async () => {
    const res = mockResponse();
    await handler(mockRequest({ method: 'GET' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('answers 401 when the caller is not authenticated', async () => {
    authenticateUser.mockRejectedValue(new FakeAuthError('no token'));
    const res = mockResponse();
    await handler(del('users/user-1/a.pdf'), res);

    expect(res.statusCode).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it('requires a key', async () => {
    const res = mockResponse();
    await handler(del(), res);
    expect(res.statusCode).toBe(400);
  });

  it('deletes an object inside the caller own prefix', async () => {
    const res = mockResponse();
    await handler(del('users/user-1/a.pdf'), res);

    expect(res.statusCode).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('refuses a key belonging to another user', async () => {
    const res = mockResponse();
    await handler(del('users/user-2/secret.pdf'), res);

    expect(res.statusCode).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it('is not fooled by a prefix that merely starts the same', async () => {
    // "users/user-1" must not authorise "users/user-10/".
    const res = mockResponse();
    await handler(del('users/user-10/secret.pdf'), res);
    expect(res.statusCode).toBe(403);
  });

  it('refuses a key that climbs out of the prefix', async () => {
    const res = mockResponse();
    await handler(del('../users/user-2/secret.pdf'), res);

    expect(res.statusCode).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it('reports a storage failure as 500', async () => {
    send.mockRejectedValue(new Error('bucket unreachable'));
    const res = mockResponse();
    await handler(del('users/user-1/a.pdf'), res);
    expect(res.statusCode).toBe(500);
  });
});
