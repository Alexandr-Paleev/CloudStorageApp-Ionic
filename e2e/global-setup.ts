import { supabaseReady, sweepAbandonedAccounts } from './fixtures';

/**
 * Before any test: the accounts a run that never reached its teardown left in
 * the real project (see sweepAbandonedAccounts).
 *
 * A failure here is reported and not thrown. What it would stop is this run,
 * whose own accounts are cleaned up as before; the leftovers wait for the next
 * sweep. On GitHub the line is an annotation on the run page, so a sweep that
 * keeps failing is seen rather than quietly skipped.
 */
export default async function globalSetup(): Promise<void> {
  if (!supabaseReady) return;

  try {
    const swept = await sweepAbandonedAccounts();
    if (swept > 0) console.log(`[e2e] deleted ${swept} account(s) that earlier runs left behind`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`::warning::[e2e] could not sweep the accounts earlier runs left: ${message}`);
  }
}
