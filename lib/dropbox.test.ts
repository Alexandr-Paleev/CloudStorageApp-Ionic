import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { assertSameOrigin, exchangeCode, getDropboxAppKey, refreshAccessToken } from './dropbox';

const APP = 'https://cloud-storage-app-ionic-v0.vercel.app';

describe('assertSameOrigin', () => {
  it('accepts a redirect back to this deployment', () => {
    expect(() => assertSameOrigin(`${APP}/dropbox/callback`, APP)).not.toThrow();
    expect(() => assertSameOrigin(`${APP}/dropbox/callback?x=1`, APP)).not.toThrow();
  });

  it('refuses a redirect to somebody else', () => {
    expect(() => assertSameOrigin('https://evil.example/steal', APP)).toThrow(
      /does not belong to this deployment/
    );
  });

  it('refuses a look-alike host', () => {
    // Prefix match would let this through; origin comparison does not.
    expect(() => assertSameOrigin(`${APP}.evil.example/cb`, APP)).toThrow();
    expect(() => assertSameOrigin('https://evil.example/?x=' + APP, APP)).toThrow();
  });

  it('refuses a different scheme or port on the same host', () => {
    expect(() => assertSameOrigin('http://localhost:8100/cb', 'https://localhost:8100')).toThrow();
    expect(() => assertSameOrigin('http://localhost:9999/cb', 'http://localhost:8100')).toThrow();
  });

  it('rejects something that is not a URL at all', () => {
    expect(() => assertSameOrigin('/dropbox/callback', APP)).toThrow(/not a valid URL/);
    expect(() => assertSameOrigin('javascript:alert(1)', APP)).toThrow();
  });
});

describe('the token endpoint', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.DROPBOX_APP_KEY = 'app-key';
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DROPBOX_APP_KEY;
  });

  function respondWith(body: unknown, ok = true, status = 200) {
    fetchMock.mockResolvedValue({
      ok,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
  }

  function sentBody(): URLSearchParams {
    return fetchMock.mock.calls[0][1].body as URLSearchParams;
  }

  it('exchanges an authorization code together with its PKCE verifier', async () => {
    respondWith({ access_token: 'at', refresh_token: 'rt', expires_in: 14400, account_id: 'acc' });

    const tokens = await exchangeCode('the-code', 'the-verifier', 'https://app.example/cb');

    expect(tokens).toEqual({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresIn: 14400,
      accountId: 'acc',
    });
    expect(Object.fromEntries(sentBody())).toEqual({
      code: 'the-code',
      grant_type: 'authorization_code',
      client_id: 'app-key',
      redirect_uri: 'https://app.example/cb',
      code_verifier: 'the-verifier',
    });
  });

  it('trades a refresh token without sending the app secret', async () => {
    // This app is a public client: it holds no secret, which is the whole
    // reason the authorization step uses PKCE.
    respondWith({ access_token: 'fresh', expires_in: 14400 });

    const tokens = await refreshAccessToken('rt');

    expect(tokens.accessToken).toBe('fresh');
    expect(tokens.refreshToken).toBeUndefined();
    const body = Object.fromEntries(sentBody());
    expect(body).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'rt',
      client_id: 'app-key',
    });
    expect(Object.keys(body)).not.toContain('client_secret');
  });

  it("carries the status and Dropbox's reason into the log, not into a silent failure", async () => {
    respondWith({ error_description: 'code has expired' }, false, 400);

    await expect(exchangeCode('stale', 'verifier', 'https://app.example/cb')).rejects.toThrow(
      /Dropbox token request failed \(400\).*code has expired/
    );
  });

  it('refuses to build a request without the app key configured', () => {
    delete process.env.DROPBOX_APP_KEY;
    expect(() => getDropboxAppKey()).toThrow('DROPBOX_APP_KEY is not configured');
  });
});
