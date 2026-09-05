import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockRequest, mockResponse } from '../../lib/test-utils';

const { FakeAuthError, authenticateUser, eraseAccount } = vi.hoisted(() => ({
  FakeAuthError: class FakeAuthError extends Error {},
  authenticateUser: vi.fn(),
  eraseAccount: vi.fn(),
}));

vi.mock('../../lib/auth', () => ({
  AuthError: FakeAuthError,
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
  supabase: {},
}));

vi.mock('../../lib/account-erase', () => ({
  eraseAccount: (...args: unknown[]) => eraseAccount(...args),
}));

import handler from './delete';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  authenticateUser.mockResolvedValue('user-1');
  eraseAccount.mockResolvedValue({ failures: [] });
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
    await handler(mockRequest({ method: 'DELETE' }), res);
    expect(res.statusCode).toBe(401);
    expect(eraseAccount).not.toHaveBeenCalled();
  });

  /* The id comes from the verified token, never from the body — otherwise this
     route would delete any account whose id a caller could guess. */
  it('erases the account the token names, not one the body asks for', async () => {
    const res = mockResponse();
    await handler(mockRequest({ method: 'DELETE', body: { userId: 'someone-else' } }), res);

    expect(res.statusCode).toBe(200);
    expect(eraseAccount).toHaveBeenCalledTimes(1);
    expect(eraseAccount.mock.calls[0][0]).toBe('user-1');
  });

  it('reports the providers that could not be reached, and still says deleted', async () => {
    eraseAccount.mockResolvedValue({ failures: ['r2'] });
    const res = mockResponse();
    await handler(mockRequest({ method: 'DELETE' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ deleted: true, failures: ['r2'] });
  });

  it('answers 500 when the account itself could not be deleted', async () => {
    eraseAccount.mockRejectedValue(new Error('Failed to delete the account: nope'));
    const res = mockResponse();
    await handler(mockRequest({ method: 'DELETE' }), res);
    expect(res.statusCode).toBe(500);
  });
});
