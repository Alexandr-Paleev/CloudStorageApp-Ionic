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

export async function authenticateUser(req: VercelRequest): Promise<string> {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new AuthError('Missing authorization token');

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) throw new AuthError('Invalid or expired token');
  return user.id;
}

export { supabase };
