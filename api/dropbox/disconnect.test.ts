import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockRequest, mockResponse, mockSupabase, type RecordedCall } from '../../lib/test-utils';

const { FakeAuthError, authenticateUser, db } = vi.hoisted(() => ({
  FakeAuthError: class FakeAuthError extends Error {},
  authenticateUser: vi.fn(),
  db: {
    client: null as { from: (t: string) => unknown } | null,
    calls: [] as { table: string; op: string; args?: unknown[] }[],
  },
}));

vi.mock('../../lib/auth', () => ({
  AuthError: FakeAuthError,
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
  supabase: { from: (table: string) => db.client!.from(table) },
}));

import handler from './disconnect';

function setup(answer: { data?: unknown[] | null; error?: { message: string } } = { data: [] }) {
  const mock = mockSupabase({ dropbox_connections: answer });
  db.client = mock.client;
  db.calls = mock.calls;
}

beforeEach(() => {
  vi.clearAllMocks();
  authenticateUser.mockResolvedValue('user-1');
  setup();
});

describe('dropbox disconnect', () => {
  it('refuses anything but POST', async () => {
    const res = mockResponse();
    await handler(mockRequest({ method: 'GET' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('answers 401 when the caller is not authenticated', async () => {
    authenticateUser.mockRejectedValue(new FakeAuthError('no token'));
    const res = mockResponse();
    await handler(mockRequest(), res);

    expect(res.statusCode).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it('deletes the stored connection', async () => {
    const res = mockResponse();
    await handler(mockRequest(), res);

    expect(res.statusCode).toBe(200);
    expect(db.calls as RecordedCall[]).toContainEqual({
      table: 'dropbox_connections',
      op: 'delete',
    });
  });

  it('succeeds when there was nothing to disconnect', async () => {
    // Disconnecting twice is not an error worth surfacing to the user.
    const res = mockResponse();
    await handler(mockRequest(), res);
    expect(res.statusCode).toBe(200);
  });

  it('reports a failed delete as 500', async () => {
    setup({ error: { message: 'connection reset' } });
    const res = mockResponse();
    await handler(mockRequest(), res);
    expect(res.statusCode).toBe(500);
  });
});
