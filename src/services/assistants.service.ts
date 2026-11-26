import { supabase } from '../supabase/supabase.config';
import { isAuthorizationId } from '../utils/pending-consent';

/**
 * The assistants a person lets read their files through `/mcp` (ADR 0020),
 * as Supabase Auth's OAuth server keeps them: the request an assistant is
 * signing in with, the person's answer to it, and the grants that answer
 * leaves until it is revoked.
 *
 * Every call carries the person's own session; Supabase decides whose
 * request and whose grant it is.
 */

/** An assistant asking to be let in, as the consent page shows it. */
export interface AccessRequest {
  id: string;
  client: { id: string; name: string; uri: string; logoUri: string };
  /** Where the person is sent back to after answering: the assistant's own address. */
  redirectUri: string;
  email: string;
}

/** An assistant let in, until revoked. */
export interface Grant {
  clientId: string;
  name: string;
  uri: string;
  grantedAt: string;
}

/**
 * Schemes a page can be sent to only to run something in it. An assistant's
 * redirect address can be any other: `https:`, `http://localhost` for a
 * client on the person's machine, an app's own scheme (`cursor:`, `vscode:`).
 */
const NOT_A_PLACE = new Set(['javascript:', 'data:', 'vbscript:', 'blob:', 'file:']);

/** The address Supabase says to go to next, or an error if it is not a place. */
export function placeToGo(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('The assistant’s address could not be read.');
  }
  if (NOT_A_PLACE.has(parsed.protocol)) {
    throw new Error('The assistant’s address is not one this page will open.');
  }
  return parsed.href;
}

/** Leaves the app for the assistant's address. */
export function leaveFor(url: string): void {
  window.location.assign(url);
}

/**
 * Where the person is sent back to, as they can recognise it: the host of an
 * address on the web, the scheme of an app's own (`cursor:`).
 */
export function whereBack(redirectUri: string): string {
  try {
    const url = new URL(redirectUri);
    return url.host || url.protocol.slice(0, -1);
  } catch {
    return redirectUri;
  }
}

function failed(error: { message?: string } | null, fallback: string): Error {
  return new Error(error?.message || fallback);
}

/** Either the request to answer, or, when it was answered before, where to go. */
export type Pending = { kind: 'ask'; request: AccessRequest } | { kind: 'answered'; goTo: string };

const assistantsService = {
  async pending(authorizationId: string): Promise<Pending> {
    if (!isAuthorizationId(authorizationId)) throw new Error('This sign-in link is not complete.');
    const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
    if (error || !data) throw failed(error, 'Could not read what the assistant asks for.');
    if (!('authorization_id' in data))
      return { kind: 'answered', goTo: placeToGo(data.redirect_url) };
    return {
      kind: 'ask',
      request: {
        id: data.authorization_id,
        client: {
          id: data.client.id,
          name: data.client.name,
          uri: data.client.uri,
          logoUri: data.client.logo_uri,
        },
        redirectUri: data.redirect_uri,
        email: data.user.email,
      },
    };
  },

  /** Approves or denies the request, and says where to go: back to the assistant. */
  async answer(authorizationId: string, allow: boolean): Promise<string> {
    if (!isAuthorizationId(authorizationId)) throw new Error('This sign-in link is not complete.');
    const call = allow
      ? supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
      : supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
    const { data, error } = await call;
    if (error || !data) throw failed(error, 'Could not send the answer.');
    return placeToGo(data.redirect_url);
  },

  /**
   * The grants, or null where Supabase has no OAuth server to ask: its
   * endpoints answer 404 until it is turned on. Null rather than an error,
   * which every query reports to Google Analytics (query-client.ts), once
   * for each visit of the account page.
   */
  async grants(): Promise<Grant[] | null> {
    const { data, error } = await supabase.auth.oauth.listGrants();
    if ((error as { status?: number } | null)?.status === 404) return null;
    if (error || !data) throw failed(error, 'Could not list the assistants.');
    return data.map((grant) => ({
      clientId: grant.client.id,
      name: grant.client.name,
      uri: grant.client.uri,
      grantedAt: grant.granted_at,
    }));
  },

  /** Ends the assistant's access: its sessions and refresh tokens go with it. */
  async revoke(clientId: string): Promise<void> {
    const { error } = await supabase.auth.oauth.revokeGrant({ clientId });
    if (error) throw failed(error, 'Could not revoke the assistant’s access.');
  },
};

export default assistantsService;
