import { describe, it, expect, beforeEach, vi } from 'vitest';
import accountService from './account.service';

const getSession = vi.fn();
const signOut = vi.fn();

vi.mock('../supabase/supabase.config', () => ({
  supabase: { auth: { getSession: () => getSession(), signOut: () => signOut() } },
}));

const fetchMock = vi.fn();

/** What happened, in the order it happened — the order is the whole subject. */
let order: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  order = [];
  vi.stubGlobal('fetch', fetchMock);
  getSession.mockResolvedValue({ data: { session: { access_token: 'jwt' } } });
  signOut.mockImplementation(async () => {
    order.push('signOut');
    return { error: null };
  });
  fetchMock.mockImplementation(async () => {
    order.push('delete');
    return { ok: true, json: async () => ({ deleted: true, failures: [] }) };
  });
});

describe('deleting the account', () => {
  it('asks with the session token, since the server deletes whoever the token names', async () => {
    await accountService.deleteAccount();

    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(init.method).toBe('DELETE');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
  });

  /* Signing out first would throw away the only proof of who is asking, and the
     request would come back 401 with the account still there. */
  it('signs out after the account is gone, never before', async () => {
    await accountService.deleteAccount();
    expect(order).toEqual(['delete', 'signOut']);
  });

  /* By the time signOut runs the user it would sign out no longer exists, so
     its own call can fail. The account is no less deleted for it, and an error
     here would tell the user the opposite. */
  it('still reports success when signing out fails', async () => {
    signOut.mockRejectedValue(new Error('session already gone'));
    await expect(accountService.deleteAccount()).resolves.toEqual({ failures: [] });
  });

  /* The mirror image: a refused deletion must leave the session alone. Clearing
     it would log someone out of an account that still exists and still holds
     their files. */
  it('leaves the session alone when the deletion is refused', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ message: 'Access denied' }) });

    await expect(accountService.deleteAccount()).rejects.toThrow('Access denied');
    expect(signOut).not.toHaveBeenCalled();
  });

  it('survives an error body that is not JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    });

    await expect(accountService.deleteAccount()).rejects.toThrow('Failed to delete the account');
  });

  /* Google Drive and Dropbox files live in the user's own cloud and cannot be
     reached from here; a bucket can also simply be unreachable for a moment.
     The interface has to be able to say which, so the list is passed through
     rather than folded into a boolean. */
  it('passes through the providers that could not be reached', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ deleted: true, failures: ['r2', 'cloudinary'] }),
    });

    await expect(accountService.deleteAccount()).resolves.toEqual({
      failures: ['r2', 'cloudinary'],
    });
  });

  it('reads a response with no failures list as none', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ deleted: true }) });
    await expect(accountService.deleteAccount()).resolves.toEqual({ failures: [] });
  });
});
