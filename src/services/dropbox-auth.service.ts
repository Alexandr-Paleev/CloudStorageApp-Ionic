import { env } from '../env';

const ACCESS_TOKEN_KEY = 'dropbox_access_token';
const REFRESH_TOKEN_KEY = 'dropbox_refresh_token';
const EXPIRY_KEY = 'dropbox_token_expiry';
const VERIFIER_KEY = 'dropbox_code_verifier';
const STATE_KEY = 'dropbox_oauth_state';

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

function saveTokens(data: { access_token: string; refresh_token?: string; expires_in?: number }) {
  localStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
  if (data.refresh_token) {
    localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
  }
  if (data.expires_in) {
    const expiry = Date.now() + data.expires_in * 1000;
    localStorage.setItem(EXPIRY_KEY, expiry.toString());
  }
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
    const appKey = env.VITE_DROPBOX_APP_KEY;
    const redirectUri = env.VITE_DROPBOX_REDIRECT_URI;
    const codeVerifier = sessionStorage.getItem(VERIFIER_KEY);
    const expectedState = sessionStorage.getItem(STATE_KEY);
    if (!appKey || !redirectUri || !codeVerifier) {
      throw new Error('Dropbox auth state missing');
    }
    if (!state || !expectedState || state !== expectedState) {
      throw new Error('Dropbox authorization state mismatch. Please reconnect.');
    }

    const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        client_id: appKey,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to exchange Dropbox auth code');
    }

    const data = await response.json();
    saveTokens(data);
    sessionStorage.removeItem(VERIFIER_KEY);
    sessionStorage.removeItem(STATE_KEY);
    return data.access_token;
  },

  async refreshAccessToken(): Promise<string> {
    const appKey = env.VITE_DROPBOX_APP_KEY;
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!appKey || !refreshToken) {
      throw new Error('Cannot refresh — no refresh token. Please reconnect Dropbox.');
    }

    const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: appKey,
      }),
    });

    if (!response.ok) {
      this.logout();
      throw new Error('Dropbox session expired. Please reconnect.');
    }

    const data = await response.json();
    saveTokens(data);
    return data.access_token;
  },

  async getAccessToken(): Promise<string | null> {
    const token = localStorage.getItem(ACCESS_TOKEN_KEY);
    if (!token) return null;

    // Check if token is expired (with 5 min buffer)
    const expiry = localStorage.getItem(EXPIRY_KEY);
    if (expiry && Date.now() > parseInt(expiry) - 5 * 60 * 1000) {
      try {
        return await this.refreshAccessToken();
      } catch {
        return null;
      }
    }

    return token;
  },

  isAuthorized(): boolean {
    return !!localStorage.getItem(ACCESS_TOKEN_KEY);
  },

  logout(): void {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(EXPIRY_KEY);
  },
};

export default dropboxAuthService;
