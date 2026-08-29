import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockRequest, mockResponse, mockSupabase, type RecordedCall } from '../../lib/test-utils';

const APP_URL = 'https://app.example';

const { FakeAuthError, authenticateUser, db, exchangeCode } = vi.hoisted(() => ({
  FakeAuthError: class FakeAuthError extends Error {},
  authenticateUser: vi.fn(),
  db: {
    client: null as { from: (t: string) => unknown } | null,
    calls: [] as { table: string; op: string; args?: unknown[] }[],
  },
  exchangeCode: vi.fn(),
}));

vi.mock('../../lib/auth', () => ({
  AuthError: FakeAuthError,
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
  supabase: { from: (table: string) => db.client!.from(table) },
}));

vi.mock('../../lib/dropbox', async (importOriginal) => {
  // assertSameOrigin is the thing under test here — keep the real one.
  const actual = await importOriginal<typeof import('../../lib/dropbox')>();
  return { ...actual, exchangeCode: (...args: unknown[]) => exchangeCode(...args) };
});

import handler from './callback';

function setup(answer: { data?: unknown[] | null; error?: { message: string } } = { data: [] }) {
  const mock = mockSupabase({ dropbox_connections: answer });
  db.client = mock.client;
  db.calls = mock.calls;
}

const post = (body: Record<string, unknown>) =>
  mockRequest({ body, headers: { authorization: 'Bearer t', origin: APP_URL } });

const VALID = {
  code: 'auth-code',
  codeVerifier: 'verifier',
  redirectUri: `${APP_URL}/dropbox/callback`,
};

beforeEach(() => {
  vi.clearAllMocks();
  authenticateUser.mockResolvedValue('user-1');
  setup();
  exchangeCode.mockResolvedValue({
    accessToken: 'access-abc',
    refreshToken: 'refresh-xyz',
    expiresIn: 14400,
    accountId: 'dbid:1',
  });
});

describe('dropbox callback: access', () => {
  it('refuses anything but POST', async () => {
    const res = mockResponse();
    await handler(mockRequest({ method: 'GET' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('answers 401 when the caller is not authenticated', async () => {
    authenticateUser.mockRejectedValue(new FakeAuthError('no token'));
    const res = mockResponse();
    await handler(post(VALID), res);

    expect(res.statusCode).toBe(401);
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it.each(['code', 'codeVerifier', 'redirectUri'])('requires %s', async (missing) => {
    const body = { ...VALID } as Record<string, unknown>;
    delete body[missing];
    const res = mockResponse();
    await handler(post(body), res);

    expect(res.statusCode).toBe(400);
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it('refuses a redirect URI pointing at another host', async () => {
    // Dropbox checks it against the app's registered list too, but a caller
    // should not get to name an arbitrary host here either.
    const res = mockResponse();
    await handler(post({ ...VALID, redirectUri: 'https://evil.example/steal' }), res);

    expect(res.statusCode).toBe(500);
    expect(exchangeCode).not.toHaveBeenCalled();
  });
});

describe('dropbox callback: storing the connection', () => {
  it('keeps the refresh token and returns only the access token', async () => {
    const res = mockResponse();
    await handler(post(VALID), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ accessToken: 'access-abc', expiresIn: 14400 });
    expect(JSON.stringify(res.body)).not.toContain('refresh-xyz');
  });

  it('writes the refresh token against the caller own row', async () => {
    await handler(post(VALID), mockResponse());

    const write = (db.calls as RecordedCall[]).find((c) => c.op === 'upsert');
    const row = write?.args?.[0] as Record<string, unknown>;
    expect(row).toMatchObject({ user_id: 'user-1', refresh_token: 'refresh-xyz' });
  });

  it('rejects a grant that carries no refresh token', async () => {
    // Without token_access_type=offline the connection would silently die in
    // a few hours, with nothing to renew it.
    exchangeCode.mockResolvedValue({ accessToken: 'access-abc', expiresIn: 14400 });
    const res = mockResponse();
    await handler(post(VALID), res);

    expect(res.statusCode).toBe(502);
    expect((db.calls as RecordedCall[]).some((c) => c.op === 'upsert')).toBe(false);
  });

  it('reports a failed write as 500', async () => {
    setup({ error: { message: 'connection reset' } });
    const res = mockResponse();
    await handler(post(VALID), res);
    expect(res.statusCode).toBe(500);
  });

  it('reports a rejected exchange as 500', async () => {
    exchangeCode.mockRejectedValue(new Error('invalid_grant'));
    const res = mockResponse();
    await handler(post(VALID), res);
    expect(res.statusCode).toBe(500);
  });
});
