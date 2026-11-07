/**
 * What the login page says once an account has been deleted, left for it in
 * sessionStorage.
 *
 * It travelled in the router's state, and in a browser it never arrived.
 * Deleting signs the session out, and the sign-out reaches the auth context
 * as an ordinary update, while React Router 7 makes every change of address
 * a transition. React renders the ordinary update first, on the address
 * still committed: the account page with no account, where PrivateRoute
 * redirects to /login with a `<Navigate>` of its own. That one carries no
 * state, and it replaced the history entry the account page had just
 * written. The unit tests mock the auth context and passed; the end-to-end
 * suite, in a real browser, found the page saying nothing.
 *
 * So the account service leaves this before it signs out, when no redirect
 * has happened yet, and the login page takes it when it opens. Taken once:
 * opening the page again does not say it again. Not in the address either,
 * where analytics would read it.
 */
const KEY = 'account-deleted';

export interface DeletionNotice {
  /** The providers the server could not empty straight away. */
  failures: string[];
}

export function leaveDeletionNotice(notice: DeletionNotice): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(notice));
  } catch {
    /* Storage refused: the page says nothing, as it did before. The account
       is no less deleted. */
  }
}

/** The notice left for the login page, removed as it is read, or null. */
export function takeDeletionNotice(): DeletionNotice | null {
  try {
    const left = sessionStorage.getItem(KEY);
    if (left === null) return null;
    sessionStorage.removeItem(KEY);

    const failures = (JSON.parse(left) as { failures?: unknown } | null)?.failures;
    return {
      failures: Array.isArray(failures)
        ? failures.filter((name): name is string => typeof name === 'string')
        : [],
    };
  } catch {
    return null;
  }
}
