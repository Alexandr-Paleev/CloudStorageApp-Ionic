import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateUser, AuthError, supabase } from '../../lib/auth';
import { getAppUrl } from '../../lib/app-url';
import { assertSameOrigin, exchangeCode } from '../../lib/dropbox';

/**
 * Exchanges the OAuth code for tokens and keeps the refresh token here.
 *
 * The browser gets the access token back and nothing else: it is short-lived
 * and needed for direct-to-Dropbox uploads, while the refresh token — the one
 * that would hand an attacker permanent access — never reaches the client.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const userId = await authenticateUser(req);

    const { code, codeVerifier, redirectUri } = req.body as {
      code?: string;
      codeVerifier?: string;
      redirectUri?: string;
    };

    if (!code || !codeVerifier || !redirectUri) {
      return res.status(400).json({ message: 'code, codeVerifier and redirectUri are required' });
    }

    assertSameOrigin(redirectUri, getAppUrl(req));

    const tokens = await exchangeCode(code, codeVerifier, redirectUri);

    if (!tokens.refreshToken) {
      // Without token_access_type=offline Dropbox returns no refresh token, and
      // the connection would silently die in a few hours.
      return res.status(502).json({ message: 'Dropbox returned no refresh token' });
    }

    const { error } = await supabase.from('dropbox_connections').upsert(
      {
        user_id: userId,
        refresh_token: tokens.refreshToken,
        account_id: tokens.accountId ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

    if (error) throw new Error(`Failed to store Dropbox connection: ${error.message}`);

    return res.status(200).json({
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('Dropbox callback error:', error);
    return res.status(error instanceof AuthError ? 401 : 500).json({ message });
  }
}
