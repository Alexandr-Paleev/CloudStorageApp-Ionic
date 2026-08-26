const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';

export interface DropboxTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  accountId?: string;
}

/**
 * The app key is public by design — it travels in the authorize URL the browser
 * opens. It still gets its own server-side variable rather than reading the
 * VITE_ one: serverless code falling back to VITE_-prefixed values is how
 * secrets end up inlined into the public bundle.
 */
export function getDropboxAppKey(): string {
  const key = process.env.DROPBOX_APP_KEY;
  if (!key) throw new Error('DROPBOX_APP_KEY is not configured');
  return key;
}

async function postToken(body: URLSearchParams): Promise<DropboxTokens> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    // Dropbox puts the reason in the body; keep it out of the client response
    // but make it findable in the function logs.
    const detail = await response.text().catch(() => '');
    throw new Error(`Dropbox token request failed (${response.status}): ${detail}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    account_id?: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    accountId: data.account_id,
  };
}

/** Authorization code + PKCE verifier → tokens. */
export function exchangeCode(
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<DropboxTokens> {
  return postToken(
    new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: getDropboxAppKey(),
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    })
  );
}

/** Refresh token → a fresh short-lived access token. */
export function refreshAccessToken(refreshToken: string): Promise<DropboxTokens> {
  return postToken(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: getDropboxAppKey(),
    })
  );
}

/**
 * Only accept a redirect URI on this deployment's own origin. Dropbox already
 * checks it against the app's registered list, but a caller should not get to
 * name an arbitrary host here either.
 */
export function assertSameOrigin(redirectUri: string, appUrl: string): void {
  let target: URL;
  try {
    target = new URL(redirectUri);
  } catch {
    throw new Error('redirectUri is not a valid URL');
  }
  if (target.origin !== new URL(appUrl).origin) {
    throw new Error('redirectUri does not belong to this deployment');
  }
}
