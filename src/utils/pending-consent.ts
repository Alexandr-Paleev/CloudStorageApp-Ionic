/**
 * An assistant's sign-in that is waiting for the person to sign in first
 * (ADR 0020), kept in sessionStorage.
 *
 * Supabase sends the person to `/oauth/consent?authorization_id=…`. Signed
 * out, they have to sign in before they can answer, and every way of signing
 * in ends somewhere else: the form goes on to the dashboard, Google to the
 * address it was given to come back to. So the consent page leaves the id here, and
 * whichever way the sign-in went, it comes back to the page.
 *
 * Not in the router's state, which a sign-in through Google does not keep,
 * and not in the address of the pages in between, where analytics would read
 * it. Taken once it is answered; this tab's alone, gone with it.
 */
const KEY = 'pending-consent';

/**
 * What an authorization id looks like. supabase-js puts it into the path of
 * the request as it is, so an id from the address bar is checked before it
 * is used: one with a `/` or a `..` in it would send the person's session
 * to another endpoint of Supabase Auth, of a link's writer's choosing.
 */
const AUTHORIZATION_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function isAuthorizationId(value: string | null | undefined): value is string {
  return typeof value === 'string' && AUTHORIZATION_ID.test(value);
}

export const CONSENT_PATH = '/oauth/consent';

export function leavePendingConsent(authorizationId: string): void {
  try {
    sessionStorage.setItem(KEY, authorizationId);
  } catch {
    /* Storage refused: after signing in the person lands on the dashboard,
       and the assistant's sign-in has to be started again. */
  }
}

/** The waiting sign-in's id, left where it is, or null. */
export function pendingConsent(): string | null {
  try {
    const id = sessionStorage.getItem(KEY);
    return isAuthorizationId(id) ? id : null;
  } catch {
    return null;
  }
}

export function clearPendingConsent(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* Nothing to clear where nothing could be kept. */
  }
}

/** Where a sign-in leads: back to an assistant's waiting sign-in, if there is one. */
export function afterSignIn(): string {
  return pendingConsent() ? CONSENT_PATH : '/dashboard';
}
