import { env } from '../env';
import { supabase } from '../supabase/supabase.config';

const VERIFIER_KEY = 'dropbox_code_verifier';
const STATE_KEY = 'dropbox_oauth_state';

/** Keys this service used to write. Cleared once, so tokens issued before the
 *  server-side flow do not keep sitting in localStorage on returning devices. */
const LEGACY_TOKEN_KEYS = ['dropbox_access_token', 'dropbox_refresh_token', 'dropbox_token_expiry'];

function purgeLegacyTokens(): void {
  for (const key of LEGACY_TOKEN_KEYS) localStorage.removeItem(key);
}
purgeLegacyTokens();

/**
 * The access token lives here and nowhere else — not in localStorage, not in
 * sessionStorage. It dies with the tab, and /api/dropbox/token mints a new one
 * from the refresh token, which never leaves the server.
 */
let accessToken: string | null = null;
let expiresAt = 0;

function cacheToken(token: string, expiresIn: number | null): void {
  accessToken = token;
  // Refresh a little early rather than let an upload fail mid-flight.
  expiresAt = expiresIn ? Date.now() + expiresIn * 1000 - 5 * 60 * 1000 : 0;
}

async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return {
    'Content-Type': 'application/json',
    ...(session?.access_token && { Authorization: `Bearer ${session.access_token}` }),
  };
}

function randomHex(byteLength: number): string {
  const array = new Uint8Array(byteLength);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

function generateCodeVerifier(): string {
  return randomHex(32);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const dropboxAuthService = {
  async authorize(): Promise<void> {
    const appKey = env.VITE_DROPBOX_APP_KEY;
    const redirectUri = env.VITE_DROPBOX_REDIRECT_URI;
    if (!appKey || !redirectUri) {
      throw new Error('Dropbox is not configured');
    }

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    // CSRF guard: Dropbox returns state to the redirect URI unchanged
    const state = randomHex(16);
    // Both are single-use and worthless without the code that arrives on the
    // redirect, so sessionStorage is fine — unlike a refresh token.
    sessionStorage.setItem(VERIFIER_KEY, codeVerifier);
    sessionStorage.setItem(STATE_KEY, state);

    const params = new URLSearchParams({
      client_id: appKey,
      redirect_uri: redirectUri,
      response_type: 'code',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      token_access_type: 'offline',
      state,
    });

    window.location.href = `https://www.dropbox.com/oauth2/authorize?${params}`;
  },

  async handleCallback(code: string, state: string | null): Promise<string> {
    const redirectUri = env.VITE_DROPBOX_REDIRECT_URI;
    const codeVerifier = sessionStorage.getItem(VERIFIER_KEY);
    const expectedState = sessionStorage.getItem(STATE_KEY);
    if (!redirectUri || !codeVerifier) {
      throw new Error('Dropbox auth state missing');
    }
    if (!state || !expectedState || state !== expectedState) {
      throw new Error('Dropbox authorization state mismatch. Please reconnect.');
    }

    const response = await fetch('/api/dropbox/callback', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ code, codeVerifier, redirectUri }),
    });

    sessionStorage.removeItem(VERIFIER_KEY);
    sessionStorage.removeItem(STATE_KEY);

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message || 'Failed to connect Dropbox');
    }

    const { accessToken: token, expiresIn } = await response.json();
    cacheToken(token, expiresIn);
    return token;
  },

  async getAccessToken(): Promise<string | null> {
    if (accessToken && (expiresAt === 0 || Date.now() < expiresAt)) {
      return accessToken;
    }

    const response = await fetch('/api/dropbox/token', {
      method: 'POST',
      headers: await authHeaders(),
    });

    if (!response.ok) {
      // 404 is the normal "not connected" answer, not an error worth throwing.
      accessToken = null;
      expiresAt = 0;
      return null;
    }

    const { accessToken: token, expiresIn } = await response.json();
    cacheToken(token, expiresIn);
    return token;
  },

  /** Asks the server, since the browser no longer holds any Dropbox state. */
  async isAuthorized(): Promise<boolean> {
    return (await this.getAccessToken()) !== null;
  },

  async logout(): Promise<void> {
    accessToken = null;
    expiresAt = 0;
    purgeLegacyTokens();

    await fetch('/api/dropbox/disconnect', {
      method: 'POST',
      headers: await authHeaders(),
    }).catch(() => {
      // Local state is already gone; a failed call only leaves a stale row.
    });
  },
};

export default dropboxAuthService;
