/**
 * How an assistant finds where to sign in for `/mcp` (ADR 0020): `/mcp` is an
 * OAuth 2.1 resource server, Supabase Auth its authorization server.
 *
 * A request without a usable token is answered 401 with a `WWW-Authenticate`
 * header naming this server's protected resource metadata (RFC 9728); the
 * metadata names Supabase Auth, whose own metadata says where to register,
 * sign in and get a token. Both are told the address the assistant used, so a
 * preview deployment describes itself and not production.
 */

/** Where `/mcp`'s metadata is, as RFC 9728 places it for a resource at `/mcp`. */
export const RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource/mcp';

/**
 * What an assistant is told to ask for. Supabase's scopes are OpenID's and
 * gate none of the data (ADR 0020); `email` is the one it grants when asked
 * for none. `openid` is left out: it asks for an ID token, which Supabase
 * signs only with an asymmetric key, and a project signing with its shared
 * secret would fail the sign-in.
 */
export const MCP_SCOPES = ['email'] as const;

function origin(host: string): string {
  return `https://${host}`;
}

/** The issuer of a Supabase project: its URL with `/auth/v1`. */
export function authorizationServer(supabaseUrl: string): string {
  let url = supabaseUrl;
  while (url.endsWith('/')) url = url.slice(0, -1);
  return `${url}/auth/v1`;
}

/** The protected resource metadata of `/mcp` at this host (RFC 9728). */
export function protectedResourceMetadata(host: string, supabaseUrl: string) {
  return {
    resource: `${origin(host)}/mcp`,
    authorization_servers: [authorizationServer(supabaseUrl)],
    bearer_methods_supported: ['header'],
    scopes_supported: [...MCP_SCOPES],
    resource_name: 'Cloud Storage',
  };
}

/**
 * The `WWW-Authenticate` of a 401 from `/mcp`: where the metadata is, and
 * what to ask for. `invalid_token` when a token came and was not one `/mcp`
 * takes (expired, revoked, or a person's own session), so that a client
 * signs in again rather than resend it.
 */
export function mcpChallenge(host: string, tokenSent: boolean): string {
  const parts = [
    `resource_metadata="${origin(host)}${RESOURCE_METADATA_PATH}"`,
    `scope="${MCP_SCOPES.join(' ')}"`,
  ];
  if (tokenSent) parts.unshift('error="invalid_token"');
  return `Bearer ${parts.join(', ')}`;
}
