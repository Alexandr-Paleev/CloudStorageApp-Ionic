import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateUser, AuthError, supabase } from '../../lib/auth';
import { applyCors } from '../../lib/cors';

/** Forgets the stored refresh token. Disconnecting has to happen server-side
 *  now that the browser no longer holds one. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  /* Before anything else: a preflight from the native shell carries no
     Authorization header, and everything below expects one. */
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const userId = await authenticateUser(req);

    const { error } = await supabase.from('dropbox_connections').delete().eq('user_id', userId);
    if (error) throw new Error(`Failed to disconnect Dropbox: ${error.message}`);

    return res.status(200).json({ disconnected: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('Dropbox disconnect error:', error);
    return res.status(error instanceof AuthError ? 401 : 500).json({ message });
  }
}
