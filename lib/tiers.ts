/**
 * The single source of truth for what each tier gets.
 *
 * These numbers decide both what the client shows and what the server enforces,
 * and they used to live in two hand-synced copies — `api/stripe/webhook.ts` and
 * `src/types/billing.types.ts` — plus three more spellings of "500 MB" scattered
 * around. A copy that drifts here does not throw: it either sells storage the
 * server refuses to accept, or hands out space nobody paid for.
 *
 * `lib/` is compiled into both tsconfigs, so there is no longer any reason for
 * the copies to exist.
 *
 * Changing `storage_limit` also means updating the DEFAULT on `profiles`
 * (see migrations/001) — the database has its own copy for new rows.
 */
export const TIER_LIMITS = {
  free: {
    storage_limit: 500 * 1024 * 1024, // 500 MB
    allowed_providers: ['cloudinary', 'r2', 'supabase_storage', 'googledrive'],
  },
  pro: {
    storage_limit: 5 * 1024 * 1024 * 1024, // 5 GB
    allowed_providers: ['cloudinary', 'r2', 'supabase_storage', 'googledrive', 'dropbox'],
  },
} as const;

/**
 * What to assume when a profile row cannot be read — the free tier, never more.
 * Guessing high here would hand an unknown caller Pro-sized storage.
 */
export const DEFAULT_STORAGE_LIMIT = TIER_LIMITS.free.storage_limit;
