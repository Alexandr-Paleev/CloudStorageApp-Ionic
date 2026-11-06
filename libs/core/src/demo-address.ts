/**
 * The address of a demo account, the whole address `/api/demo/session` makes
 * (libs/server/src/demo.ts): `demo-`, digits, a dash, lowercase letters and
 * digits, `@example.com`.
 *
 * Both sides ask it. The server sweeps what it matches, files and all, and
 * refuses it a share link. The app offers it no storage a plan cannot give
 * it: the database holds a demo account to 10 MB on either plan
 * (migrations/019).
 *
 * The prefix alone used to be the test, and it matched people: sign-up is
 * open, by e-mail and through Google, and `demo-anna@company.com` is an
 * address its owner can confirm. example.com is reserved (RFC 2606): no mail
 * is delivered there, so no account on it can be confirmed, and Google issues
 * none.
 *
 * Text as well as a RegExp: the route counts demo profiles with it, and
 * Postgres reads it with `~` as JavaScript does.
 */
export const DEMO_EMAIL_PREFIX = 'demo-';

export const DEMO_ADDRESS_PATTERN = `^${DEMO_EMAIL_PREFIX}\\d+-[a-z0-9]*@example\\.com$`;
const DEMO_ADDRESS = new RegExp(DEMO_ADDRESS_PATTERN);

/** Whether `email` is a demo account's. A profile's address can be null. */
export function isDemoEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && DEMO_ADDRESS.test(email);
}
