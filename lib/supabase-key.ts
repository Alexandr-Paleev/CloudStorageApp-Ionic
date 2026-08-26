/**
 * Guards against the mistake that cost this project a production outage: an
 * anon key pasted into SUPABASE_SERVICE_ROLE_KEY.
 *
 * The two keys look alike and sit next to each other in the Supabase dashboard.
 * Swapping them breaks nothing loudly — a service-role key bypasses RLS, an
 * anon key does not, so every server-side query simply starts matching zero
 * rows. Handlers then report "no such row" for rows that plainly exist. The
 * wrong key sat in all three Vercel environments for 221 days before the first
 * request that actually read a table exposed it.
 *
 * See the postmortem in README.md.
 */

/**
 * Reads the `role` claim from a Supabase JWT key.
 *
 * Returns null when the key carries no readable claims — Supabase's newer
 * `sb_secret_…` keys are opaque, and an unverifiable key must not be treated
 * as a wrong one.
 */
export function readKeyRole(key: string): string | null {
  const parts = key.split('.');
  if (parts.length !== 3) return null;

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const role = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')).role;
    return typeof role === 'string' ? role : null;
  } catch {
    return null;
  }
}

/**
 * Fails the function cold when the configured key is provably not a
 * service-role key. Silence here is the dangerous outcome, so this throws at
 * module load rather than letting requests trickle through returning nothing.
 */
export function assertServiceRoleKey(key: string, varName = 'SUPABASE_SERVICE_ROLE_KEY'): void {
  const role = readKeyRole(key);
  if (role !== null && role !== 'service_role') {
    throw new Error(
      `${varName} holds a "${role}" key, not service_role. Server-side queries ` +
        `would be subject to RLS and return no rows instead of failing. ` +
        `Copy the service_role key from Supabase → Project Settings → API.`
    );
  }
}
