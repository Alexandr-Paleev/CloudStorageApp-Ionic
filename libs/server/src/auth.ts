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
 * The claims of a token, read from its payload without checking the
 * signature: each caller below has Supabase check it before trusting them
 * (`getUser` for a person, PostgREST for an assistant), and a payload altered
 * after signing is refused there.
 */
function claimsOf(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  if (!payload) return {};
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return claims !== null && typeof claims === 'object' ? (claims as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * The `client_id` claim: any value but none is an assistant's, as migrations
 * 024 and 025 read it (`auth.jwt() ->> 'client_id' IS NULL` is a person): one
 * rule here and in the database, so no token is a person to one and an
 * assistant to the other.
 */
function clientIdOf(claims: Record<string, unknown>): string | undefined {
  const clientId = claims.client_id;
  if (clientId === undefined || clientId === null) return undefined;
  return typeof clientId === 'string' ? clientId : JSON.stringify(clientId);
}

/**
 * PostgREST's codes for a token it would not take: one it cannot verify
 * (PGRST301), with no role it knows (PGRST302), or expired (PGRST303).
 */
const REFUSED_TOKEN = /^PGRST30\d$/;

/**
 * An assistant's token, at `/mcp` (ADR 0020, migration 025).
 *
 * Not through `getUser`: the hook of migration 025 gives an assistant's token
 * a `session_id` Supabase Auth has no session for, so that it is no session
 * at Auth's own endpoints (it could set the account's password there), and
 * Auth refuses it here too. The database checks it instead:
 * `assistant_session_alive`, called as the caller, has PostgREST verify the
 * signature and the expiry, and itself finds the session the assistant was
 * let in with. Revoking deletes that session, so a revoked token is refused
 * at once. A token issued while the hook was off has no `mcp_session_id` and
 * is refused as well.
 */
async function authenticateAssistant(
  req: VercelRequest,
  claims: Record<string, unknown>
): Promise<AuthenticatedUser> {
  const clientId = clientIdOf(claims);
  if (clientId === undefined) {
    throw new AuthError('/mcp takes a token issued to an assistant: connect it to sign in');
  }
  const { data, error } = await supabaseAsCaller(req).rpc('assistant_session_alive');
  if (error) {
    if (REFUSED_TOKEN.test(error.code ?? '')) throw new AuthError('Invalid or expired token');
    throw new Error(`Could not check the assistant's session: ${error.message}`);
  }
  if (data !== true) {
    throw new AuthError('This assistant was disconnected, or its sign-in ended: connect it again');
  }
  if (typeof claims.sub !== 'string' || !claims.sub)
    throw new AuthError('Invalid or expired token');
  return {
    id: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : undefined,
    clientId,
  };
}

/**
 * The caller, with the parts of them a route might need.
 *
 * `getUser` returns the whole record, and most routes want only the id — but
 * the email is what tells a demo account from a real one, and asking for it
 * separately would be a second round trip for something already in hand.
 *
 * An assistant's token is a JWT of the same kind as the person's, with one
 * claim more; without this check it could do here whatever the person can,
 * delete files and erase the account included. So every route refuses it,
 * and `/mcp`, which asks for `'agent'`, refuses everything else and checks
 * an assistant's token its own way (`authenticateAssistant`).
 */
export async function authenticate(
  req: VercelRequest,
  caller: Caller = 'person'
): Promise<AuthenticatedUser> {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new AuthError('Missing authorization token');

  const claims = claimsOf(token);
  if (caller === 'agent') return authenticateAssistant(req, claims);

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) throw new AuthError('Invalid or expired token');

  // Auth refuses an assistant's token by itself once migration 025's hook is
  // on; this holds without the hook too.
  if (clientIdOf(claims) !== undefined) {
    throw new AuthError('A token issued to an assistant only reads files, through /mcp');
  }
  return { id: user.id, email: user.email };
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
