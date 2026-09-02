import { supabase } from './auth';
import { formatBytes } from './format';
import { DEFAULT_STORAGE_LIMIT } from './tiers';

export type Quota = {
  /** Bytes the plan allows. */
  limit: number;
  /** Bytes already stored, as maintained by the trigger from migration 007. */
  used: number;
};

/**
 * Reads the account's quota.
 *
 * `bytes_used` is a counter kept by a trigger on public.files, not a sum taken
 * here: this used to page through every row the user owns on every single
 * upload, and the client did the same thing again from the browser.
 */
export async function readQuota(userId: string): Promise<Quota> {
  const { data, error } = await supabase
    .from('profiles')
    .select('storage_limit, bytes_used')
    .eq('id', userId)
    .limit(1);

  if (error) {
    // Deploy order matters: this column arrives with migrations/007. Say so
    // plainly rather than letting "column does not exist" reach the user.
    if (/bytes_used/.test(error.message)) {
      throw new Error(
        'profiles.bytes_used is missing — apply migrations/007_enforce_storage_quota.sql'
      );
    }
    // Never fall through to a default on a failed read: that would cap a Pro
    // user at the free tier and reject a legitimate upload with 413.
    throw new Error(`Failed to read the storage quota: ${error.message}`);
  }

  const rows = (data || []) as { storage_limit: number; bytes_used: number }[];

  return {
    limit: rows[0]?.storage_limit ?? DEFAULT_STORAGE_LIMIT,
    used: rows[0]?.bytes_used ?? 0,
  };
}

/**
 * The message to answer 413 with, or null when the file fits.
 *
 * This is a pre-flight, not the enforcement: the trigger on public.files is
 * what actually holds the line, and it holds it for providers that never call
 * this API at all. What this buys is a clean refusal before the bytes travel,
 * instead of an upload that succeeds into a bucket and then fails to record.
 */
export function quotaRejection(quota: Quota, size: number): string | null {
  if (quota.used + size <= quota.limit) return null;

  // A downgrade can leave an account above its new limit, so this is not only
  // the "almost full" case — say plainly where the user stands.
  const overBy =
    quota.used > quota.limit
      ? ` You are ${formatBytes(quota.used - quota.limit)} over the limit.`
      : '';

  return (
    `Storage limit exceeded. Using ${formatBytes(quota.used)} of ${formatBytes(quota.limit)}, ` +
    `and this file needs ${formatBytes(size)} more.${overBy}`
  );
}
