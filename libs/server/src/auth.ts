import type { VercelRequest } from './vercel';
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
  /** The assistant the token was issued to, for a token from Supabase's OAuth server. */
  clientId?: string;
}

/**
 * Who may present a token to a route (ADR 0020). A person's session, from the
 * app's own sign-in, everywhere but `/mcp`; an assistant's, issued through
 * Supabase's OAuth server and carrying `client_id`, at `/mcp` alone, where
 * every tool only reads.
 */
export type Caller = 'person' | 'agent';

/**
 * The `client_id` claim of a token `getUser` has just accepted. Read from the
 * payload without checking the signature again: Supabase did, and a payload
 * altered after signing would not have been accepted.
 *
 * Any value but none is an assistant's, as migration 024 reads it
 * (`auth.jwt() ->> 'client_id' IS NULL` is a person): one rule here and in
 * the database, so no token is a person to one and an assistant to the other.
 */
function clientIdOf(token: string): string | undefined {
  const payload = token.split('.')[1];
  if (!payload) return undefined;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const clientId = (claims as { client_id?: unknown } | null)?.client_id;
    if (clientId === undefined || clientId === null) return undefined;
    return typeof clientId === 'string' ? clientId : JSON.stringify(clientId);
  } catch {
    return undefined;
  }
}

/**
 * The caller, with the parts of them a route might need.
 *
 * `getUser` returns the whole record, and most routes want only the id — but
 * the email is what tells a demo account from a real one, and asking for it
 * separately would be a second round trip for something already in hand.
 * Asking Supabase rather than checking the signature alone is also what makes
 * a revoked assistant's token stop working before its hour is up.
 *
 * An assistant's token is a JWT of the same kind as the person's, with one
 * claim more; without this check it could do here whatever the person can,
 * delete files and erase the account included. So every route refuses it,
 * and `/mcp`, which asks for `'agent'`, refuses everything else.
 */
export async function authenticate(
  req: VercelRequest,
  caller: Caller = 'person'
): Promise<AuthenticatedUser> {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new AuthError('Missing authorization token');

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) throw new AuthError('Invalid or expired token');

  const clientId = clientIdOf(token);
  if (caller === 'person' && clientId !== undefined) {
    throw new AuthError('A token issued to an assistant only reads files, through /mcp');
  }
  if (caller === 'agent' && clientId === undefined) {
    throw new AuthError('/mcp takes a token issued to an assistant: connect it to sign in');
  }
  return { id: user.id, email: user.email, ...(clientId !== undefined && { clientId }) };
}

export async function authenticateUser(req: VercelRequest): Promise<string> {
  return (await authenticate(req)).id;
}

/**
 * The database as the caller sees it: their token, the public key, and every
 * policy applied. For a read that must be the caller's and nobody else's by
 * the database's own rule rather than by a filter this code remembers to add:
 * `match_chunks` (migration 022) is not granted to the service role at all,
 * which would rank every account's pieces together.
 *
 * Call after `authenticate`, which has already checked the token.
 */
export function supabaseAsCaller(req: VercelRequest) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new AuthError('Missing authorization token');
  // The same public key the browser holds; the demo's sign-in reads it too.
  const anonKey = requireEnv('VITE_SUPABASE_ANON_KEY');
  return createClient(requireEnv('SUPABASE_URL'), anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export { supabase };
