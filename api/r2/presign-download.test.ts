import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockRequest, mockResponse } from '../../lib/test-utils';

const { FakeAuthError, authenticateUser, signedUrl } = vi.hoisted(() => ({
  FakeAuthError: class FakeAuthError extends Error {},
  authenticateUser: vi.fn(),
  signedUrl: vi.fn(),
}));

vi.mock('../../lib/auth', () => ({
  AuthError: FakeAuthError,
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
  supabase: {},
}));

vi.mock('../../lib/r2', () => ({
  getS3Client: () => ({}),
  getR2BucketName: () => 'bucket',
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => signedUrl(...args),
}));

import handler from './presign-download';

const ask = (body: Record<string, unknown>) => mockRequest({ body });

beforeEach(() => {
  vi.clearAllMocks();
  authenticateUser.mockResolvedValue('user-1');
  signedUrl.mockResolvedValue('https://r2.example/signed');
});

describe('r2 presign-download', () => {
  it('refuses anything but POST', async () => {
    const res = mockResponse();
    await handler(mockRequest({ method: 'GET' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('answers 401 when the caller is not authenticated', async () => {
    authenticateUser.mockRejectedValue(new FakeAuthError('no token'));
    const res = mockResponse();
    await handler(ask({ key: 'users/user-1/a.pdf' }), res);

    expect(res.statusCode).toBe(401);
    expect(signedUrl).not.toHaveBeenCalled();
  });

  it('requires a key', async () => {
    const res = mockResponse();
    await handler(ask({}), res);
    expect(res.statusCode).toBe(400);
  });

  it('signs a URL for the caller own object', async () => {
    const res = mockResponse();
    await handler(ask({ key: 'users/user-1/a.pdf' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ url: 'https://r2.example/signed' });
  });

  it('refuses to sign somebody else object', async () => {
    // A signed URL needs no further authentication, so handing one out for
    // another user's key would be a straight read of their file.
    const res = mockResponse();
    await handler(ask({ key: 'users/user-2/private.pdf' }), res);

    expect(res.statusCode).toBe(403);
    expect(signedUrl).not.toHaveBeenCalled();
  });

  it('is not fooled by a prefix that merely starts the same', async () => {
    const res = mockResponse();
    await handler(ask({ key: 'users/user-10/private.pdf' }), res);
    expect(res.statusCode).toBe(403);
  });

  it('honours a requested lifetime', async () => {
    await handler(ask({ key: 'users/user-1/a.pdf', expiresIn: 60 }), mockResponse());
    expect(signedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      expiresIn: 60,
    });
  });

  it('falls back to an hour when none is given', async () => {
    await handler(ask({ key: 'users/user-1/a.pdf' }), mockResponse());
    expect(signedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      expiresIn: 3600,
    });
  });

  it('reports a signing failure as 500', async () => {
    signedUrl.mockRejectedValue(new Error('credentials missing'));
    const res = mockResponse();
    await handler(ask({ key: 'users/user-1/a.pdf' }), res);
    expect(res.statusCode).toBe(500);
  });
});
