import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockRequest, mockResponse, mockSupabase, type TableAnswer } from '../../lib/test-utils';

const { FakeAuthError, authenticateUser, db, refreshAccessToken } = vi.hoisted(() => ({
  FakeAuthError: class FakeAuthError extends Error {},
  authenticateUser: vi.fn(),
  db: { client: null as { from: (table: string) => unknown } | null, calls: [] as unknown[] },
  refreshAccessToken: vi.fn(),
}));

vi.mock('../../lib/auth', () => ({
  AuthError: FakeAuthError,
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
  supabase: { from: (table: string) => db.client!.from(table) },
}));

vi.mock('../../lib/dropbox', () => ({
  refreshAccessToken: (...args: unknown[]) => refreshAccessToken(...args),
}));

import handler from './token';

function withConnection(answer: TableAnswer) {
  const mock = mockSupabase({ dropbox_connections: answer });
  db.client = mock.client;
  db.calls = mock.calls;
  return mock;
}

beforeEach(() => {
  vi.clearAllMocks();
  authenticateUser.mockResolvedValue('user-1');
  withConnection({ data: [{ refresh_token: 'refresh-abc' }] });
  refreshAccessToken.mockResolvedValue({ accessToken: 'access-xyz', expiresIn: 14400 });
});

describe('dropbox token: access', () => {
  it('refuses anything but POST', async () => {
    const res = mockResponse();
    await handler(mockRequest({ method: 'GET' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('answers 401 when the caller is not authenticated', async () => {
    authenticateUser.mockRejectedValue(new FakeAuthError('Invalid or expired token'));
    const res = mockResponse();
    await handler(mockRequest(), res);

    expect(res.statusCode).toBe(401);
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });
});

describe('dropbox token: minting an access token', () => {
  it('returns a fresh access token for a connected account', async () => {
    const res = mockResponse();
    await handler(mockRequest(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ accessToken: 'access-xyz', expiresIn: 14400 });
  });

  it('never hands the refresh token back to the browser', async () => {
    // The entire point of the server-side flow: the long-lived token stays here.
    const res = mockResponse();
    await handler(mockRequest(), res);

    expect(JSON.stringify(res.body)).not.toContain('refresh-abc');
  });

  it('exchanges the stored refresh token, not something from the request', async () => {
    await handler(mockRequest({ body: { refreshToken: 'attacker-supplied' } }), mockResponse());
    expect(refreshAccessToken).toHaveBeenCalledWith('refresh-abc');
  });

  it('reports 404 when the user has no Dropbox connection', async () => {
    // Doubles as the "is Dropbox connected?" check for the client.
    withConnection({ data: [] });
    const res = mockResponse();
    await handler(mockRequest(), res);

    expect(res.statusCode).toBe(404);
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });
});

describe('dropbox token: a revoked connection', () => {
  it('answers 404 rather than 500 when Dropbox rejects the refresh', async () => {
    refreshAccessToken.mockRejectedValue(new Error('invalid_grant'));
    const res = mockResponse();
    await handler(mockRequest(), res);

    expect(res.statusCode).toBe(404);
    expect((res.body as { message: string }).message).toMatch(/reconnect/i);
  });

  it('clears the dead row so the app stops retrying it', async () => {
    refreshAccessToken.mockRejectedValue(new Error('invalid_grant'));
    await handler(mockRequest(), mockResponse());

    const ops = db.calls as { table: string; op: string }[];
    expect(ops).toContainEqual({ table: 'dropbox_connections', op: 'delete' });
  });

  it('surfaces a database failure as 500, not as "not connected"', async () => {
    // Losing the connection and failing to read it are different problems, and
    // a 404 here would tell the user to reconnect for no reason.
    withConnection({ error: { message: 'connection reset' } });
    const res = mockResponse();
    await handler(mockRequest(), res);

    expect(res.statusCode).toBe(500);
  });
});
