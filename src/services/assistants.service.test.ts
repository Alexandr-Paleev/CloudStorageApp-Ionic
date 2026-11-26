import { describe, it, expect, vi, beforeEach } from 'vitest';

const { oauth } = vi.hoisted(() => ({
  oauth: {
    getAuthorizationDetails: vi.fn(),
    approveAuthorization: vi.fn(),
    denyAuthorization: vi.fn(),
    listGrants: vi.fn(),
    revokeGrant: vi.fn(),
  },
}));

vi.mock('../supabase/supabase.config', () => ({ supabase: { auth: { oauth } } }));

import assistantsService, { placeToGo, whereBack } from './assistants.service';

const DETAILS = {
  authorization_id: 'auth-1',
  redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
  client: { id: 'c-1', name: 'Claude', uri: 'https://claude.ai', logo_uri: '' },
  user: { id: 'user-1', email: 'alex@example.com' },
  scope: 'email',
};

beforeEach(() => vi.clearAllMocks());

describe('assistantsService (ADR 0020)', () => {
  it('reads what an assistant asks for', async () => {
    oauth.getAuthorizationDetails.mockResolvedValue({ data: DETAILS, error: null });

    await expect(assistantsService.pending('auth-1')).resolves.toEqual({
      kind: 'ask',
      request: {
        id: 'auth-1',
        client: { id: 'c-1', name: 'Claude', uri: 'https://claude.ai', logoUri: '' },
        redirectUri: 'https://claude.ai/api/mcp/auth_callback',
        email: 'alex@example.com',
      },
    });
  });

  it('says where to go when the request was answered before', async () => {
    oauth.getAuthorizationDetails.mockResolvedValue({
      data: { redirect_url: 'https://claude.ai/api/mcp/auth_callback?code=x&state=y' },
      error: null,
    });

    await expect(assistantsService.pending('auth-1')).resolves.toEqual({
      kind: 'answered',
      goTo: 'https://claude.ai/api/mcp/auth_callback?code=x&state=y',
    });
  });

  it('never sends an id that could name another endpoint', async () => {
    // supabase-js puts the id into the request's path as it is.
    for (const id of ['../user', 'a/b', 'auth-1?x=1', '', 'a'.repeat(129)]) {
      await expect(assistantsService.pending(id)).rejects.toThrow('not complete');
      await expect(assistantsService.answer(id, true)).rejects.toThrow('not complete');
    }
    expect(oauth.getAuthorizationDetails).not.toHaveBeenCalled();
    expect(oauth.approveAuthorization).not.toHaveBeenCalled();
  });

  it('approves or denies without letting supabase-js leave the page', async () => {
    oauth.approveAuthorization.mockResolvedValue({
      data: { redirect_url: 'https://claude.ai/cb?code=x' },
      error: null,
    });
    oauth.denyAuthorization.mockResolvedValue({
      data: { redirect_url: 'https://claude.ai/cb?error=access_denied' },
      error: null,
    });

    await expect(assistantsService.answer('auth-1', true)).resolves.toBe(
      'https://claude.ai/cb?code=x'
    );
    await expect(assistantsService.answer('auth-1', false)).resolves.toBe(
      'https://claude.ai/cb?error=access_denied'
    );
    expect(oauth.approveAuthorization).toHaveBeenCalledWith('auth-1', {
      skipBrowserRedirect: true,
    });
    expect(oauth.denyAuthorization).toHaveBeenCalledWith('auth-1', { skipBrowserRedirect: true });
  });

  it('passes on what Supabase says went wrong', async () => {
    oauth.getAuthorizationDetails.mockResolvedValue({
      data: null,
      error: { message: 'authorization request expired' },
    });
    await expect(assistantsService.pending('auth-1')).rejects.toThrow(
      'authorization request expired'
    );
  });

  it('lists the grants and revokes one by its client', async () => {
    oauth.listGrants.mockResolvedValue({
      data: [{ client: DETAILS.client, scopes: ['email'], granted_at: '2026-11-20T10:00:00Z' }],
      error: null,
    });
    oauth.revokeGrant.mockResolvedValue({ data: {}, error: null });

    await expect(assistantsService.grants()).resolves.toEqual([
      {
        clientId: 'c-1',
        name: 'Claude',
        uri: 'https://claude.ai',
        grantedAt: '2026-11-20T10:00:00Z',
      },
    ]);
    await assistantsService.revoke('c-1');
    expect(oauth.revokeGrant).toHaveBeenCalledWith({ clientId: 'c-1' });
  });

  it('lists nothing, quietly, where Supabase has no OAuth server to ask', async () => {
    // Its endpoints are not there until it is on; an error would reach GA4
    // from every visit of the account page.
    oauth.listGrants.mockResolvedValue({
      data: null,
      error: { message: 'Not Found', status: 404 },
    });
    await expect(assistantsService.grants()).resolves.toBeNull();
  });

  it('throws when the grants cannot be listed, so the account page shows none', async () => {
    oauth.listGrants.mockResolvedValue({ data: null, error: { message: 'disabled' } });
    await expect(assistantsService.grants()).rejects.toThrow('disabled');
  });
});

describe('where an answer leads', () => {
  it('goes to the web, to the machine, and to an app’s own scheme', () => {
    for (const url of [
      'https://claude.ai/api/mcp/auth_callback?code=x',
      'http://localhost:6274/oauth/callback?code=x',
      'cursor://anysphere.cursor-mcp/oauth/callback?code=x',
    ]) {
      expect(placeToGo(url)).toBe(url);
    }
  });

  it('refuses an address that would run something in this page', () => {
    for (const url of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,x',
      'vbscript:x',
    ]) {
      expect(() => placeToGo(url)).toThrow('not one this page will open');
    }
    expect(() => placeToGo('not a url')).toThrow('could not be read');
  });

  it('names the place as the person knows it', () => {
    expect(whereBack('https://claude.ai/api/mcp/auth_callback')).toBe('claude.ai');
    expect(whereBack('http://localhost:6274/oauth/callback')).toBe('localhost:6274');
    expect(whereBack('cursor://anysphere.cursor-mcp/oauth/callback')).toBe('anysphere.cursor-mcp');
    expect(whereBack('myapp:/callback')).toBe('myapp');
  });
});
