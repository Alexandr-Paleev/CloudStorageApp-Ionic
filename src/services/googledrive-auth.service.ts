import * as Sentry from '../observability/sentry';
import { supabase } from '../supabase/supabase.config';
import { expiryOf, forgetToken, readToken, rememberToken } from './googledrive-token';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPES = 'https://www.googleapis.com/auth/drive.file';

interface TokenResponse {
  access_token: string;
  /** Seconds the token lives. */
  expires_in?: number | string;
  error?: string;
}

/** Why no token came back, as Google Identity Services reports it. */
interface TokenError {
  type?: 'popup_failed_to_open' | 'popup_closed' | 'unknown';
}

interface TokenClient {
  requestAccessToken(options?: { prompt?: string }): void;
}

interface GoogleOAuth2Config {
  client_id: string;
  scope: string;
  callback: (response: TokenResponse) => void;
  error_callback: (error: TokenError) => void;
}

declare global {
  interface Window {
    google: {
      accounts: {
        oauth2: {
          initTokenClient(config: GoogleOAuth2Config): TokenClient;
          revoke(token: string, callback: () => void): void;
        };
      };
    };
  }
}

/** Drive has to be connected (again): there is no token for this account,
 *  it ran out, or Google refused it. */
export class GoogleDriveAuthError extends Error {
  constructor(message = 'Google Drive needs to be connected again') {
    super(message);
    this.name = 'GoogleDriveAuthError';
  }
}

let tokenClient: TokenClient | null = null;
/** The request authorize() is waiting on. Google answers one at a time. */
let waiting: {
  userId: string;
  resolve: (token: string) => void;
  reject: (error: Error) => void;
} | null = null;

async function currentSession() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
}

function answered(response: TokenResponse): void {
  const request = waiting;
  waiting = null;
  if (!request) return;

  if (response.error !== undefined) {
    /* A person who says no has answered, not failed. */
    if (response.error !== 'access_denied') {
      Sentry.captureMessage('Google Drive authorization failed', {
        level: 'error',
        tags: { context: 'googledrive.authorize' },
        extra: { error: response.error },
      });
    }
    request.reject(new Error('Google Drive was not connected'));
    return;
  }

  rememberToken({
    token: response.access_token,
    userId: request.userId,
    expiresAt: expiryOf(response.expires_in),
  });
  request.resolve(response.access_token);
}

/* The window was closed, or never opened. Without this the request waited for
   a token that was not coming, and so did whatever had asked for it. */
function unanswered(error: TokenError): void {
  const request = waiting;
  waiting = null;
  request?.reject(
    new Error(
      error.type === 'popup_failed_to_open'
        ? 'The Google window could not be opened. Allow pop-ups for this site and try again.'
        : 'Google Drive was not connected'
    )
  );
}

const googleDriveAuthService = {
  /**
   * Initialize Google Identity Services
   */
  async initialize(): Promise<void> {
    if (typeof window === 'undefined') return;

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => {
        tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: SCOPES,
          callback: answered,
          error_callback: unanswered,
        });
        resolve();
      };
      /* Blocked by an extension, or no network. This promise never settled
         before, and neither did the Connect button waiting on it. */
      script.onerror = () => reject(new Error('Google sign-in could not be loaded'));
      document.head.appendChild(script);
    });
  },

  /**
   * Asks Google for a token, for the account signed in now.
   */
  async authorize(): Promise<string> {
    if (!tokenClient) {
      await this.initialize();
    }

    if (!tokenClient) {
      throw new Error('Google Drive client not initialized');
    }

    const userId = (await currentSession())?.user?.id;
    if (!userId) throw new Error('Sign in before connecting Google Drive');

    const client = tokenClient;
    return new Promise((resolve, reject) => {
      waiting?.reject(new Error('Google Drive was not connected'));
      waiting = { userId, resolve, reject };
      /* Empty rather than 'consent': Google asks only when access was never
         given or has been taken back. 'consent' put the whole consent screen
         in front of every reconnection, which a token that lasts an hour
         makes a frequent thing. */
      client.requestAccessToken({ prompt: '' });
    });
  },

  /**
   * A token for the account signed in now, or null.
   *
   * Signing in with Google hands one over with the session, and it is used
   * first; Supabase drops it when it refreshes the session, which happens
   * before the token's own hour is up. Otherwise the one Connect obtained, and
   * only if it is this account's and still alive. It used to be any string
   * under one key: kept past its hour, so Drive looked connected and every
   * upload was refused, and kept past signing out, so the next person to sign
   * in on the same browser uploaded into the previous one's Drive.
   */
  async getAccessToken(): Promise<string | null> {
    const session = await currentSession();
    if (session?.provider_token) {
      return session.provider_token;
    }

    const stored = readToken();
    if (!stored) return null;

    if (stored.userId !== session?.user?.id || stored.expiresAt <= Date.now()) {
      forgetToken();
      return null;
    }

    return stored.token;
  },

  /**
   * Check if authorized
   */
  async isAuthorized(): Promise<boolean> {
    const token = await this.getAccessToken();
    return !!token;
  },

  /**
   * Lets go of the token, when Google refuses it.
   *
   * Not revoked. The grant belongs to the person and lets the next Connect go
   * through without a consent screen; what must not outlive its use is this
   * browser's copy of the token. Signing out drops it too, through
   * googledrive-token directly (see AuthContext).
   */
  forget(): void {
    forgetToken();
  },
};

export default googleDriveAuthService;
