import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateUser, AuthError, supabase } from '../../lib/auth';
import { refreshAccessToken } from '../../lib/dropbox';
import { applyCors } from '../../lib/cors';

/**
 * Hands the caller a fresh access token for their own Dropbox connection.
 *
 * Doubles as the "is Dropbox connected?" check — 404 means no connection. The
 * client cannot answer that from the database: dropbox_connections has no RLS
 * policy, deliberately.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  /* Before anything else: a preflight from the native shell carries no
     Authorization header, and everything below expects one. */
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const userId = await authenticateUser(req);

    const { data, error } = await supabase
      .from('dropbox_connections')
      .select('refresh_token')
      .eq('user_id', userId)
      .limit(1);

    if (error) throw new Error(`Failed to read Dropbox connection: ${error.message}`);

    const rows = (data || []) as { refresh_token: string }[];
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Dropbox is not connected' });
    }

    let tokens;
    try {
      tokens = await refreshAccessToken(rows[0].refresh_token);
    } catch (refreshError) {
      // The user revoked access on Dropbox's side, or the token was rotated.
      // Drop the dead row so the app offers to reconnect instead of retrying.
      console.error('Dropbox refresh failed, clearing connection:', refreshError);
      await supabase.from('dropbox_connections').delete().eq('user_id', userId);
      return res.status(404).json({ message: 'Dropbox session expired. Please reconnect.' });
    }

    return res.status(200).json({
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('Dropbox token error:', error);
    return res.status(error instanceof AuthError ? 401 : 500).json({ message });
  }
}
