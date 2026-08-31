import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockRequest } from './test-utils';

/**
 * Every handler that touches a user's data goes through authenticateUser, and
 * every handler test mocks it — so until now the gate itself ran in no test at
 * all.
 */
const { getUser } = vi.hoisted(() => {
  // The module builds its Supabase client at import time and refuses to start
  // without these. `sb_secret_…` keys are opaque, which assertServiceRoleKey
  // accepts: an unverifiable key is not a provably wrong one.
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';

  return { getUser: vi.fn() };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: (...args: unknown[]) => getUser(...args) } }),
}));

import { authenticateUser, AuthError } from './auth';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('authenticateUser', () => {
  it('returns the id behind a valid token', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });

    await expect(authenticateUser(mockRequest())).resolves.toBe('user-1');
    expect(getUser).toHaveBeenCalledWith('test-token');
  });

  it('turns away a request carrying no token', async () => {
    await expect(authenticateUser(mockRequest({ headers: {} }))).rejects.toBeInstanceOf(AuthError);
    expect(getUser).not.toHaveBeenCalled();
  });

  it('turns away a token Supabase rejects', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'jwt expired' } });

    await expect(authenticateUser(mockRequest())).rejects.toThrow('Invalid or expired token');
  });

  it('turns away a token that resolves to no user at all', async () => {
    // Supabase can answer without an error and without a user; treating that
    // as success would authenticate a request as `undefined`.
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(authenticateUser(mockRequest())).rejects.toBeInstanceOf(AuthError);
  });

  it('accepts the header only in the form the client sends it', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });

    await authenticateUser(mockRequest({ headers: { authorization: 'Bearer abc.def.ghi' } }));

    expect(getUser).toHaveBeenCalledWith('abc.def.ghi');
  });
});
