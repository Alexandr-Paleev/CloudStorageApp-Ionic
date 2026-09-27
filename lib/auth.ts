import type { VercelRequest } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { assertServiceRoleKey } from './supabase-key';

/** Thrown when the caller is not authenticated — handlers map this to 401 */
export class AuthError extends Error {}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function requireServiceRoleKey(): string {
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  assertServiceRoleKey(key);
  return key;
}

const supabase = createClient(requireEnv('SUPABASE_URL'), requireServiceRoleKey());

/** Who the caller is, as the token check already knows it. */
export interface AuthenticatedUser {
  id: string;
  email?: string;
}

/**
 * The caller, with the parts of them a route might need.
 *
 * `getUser` returns the whole record, and most routes want only the id — but
 * the email is what tells a demo account from a real one, and asking for it
 * separately would be a second round trip for something already in hand.
 */
export async function authenticate(req: VercelRequest): Promise<AuthenticatedUser> {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new AuthError('Missing authorization token');

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) throw new AuthError('Invalid or expired token');
  return { id: user.id, email: user.email };
}

export async function authenticateUser(req: VercelRequest): Promise<string> {
  return (await authenticate(req)).id;
}

export { supabase };
