import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Erases everything one account owns, in the order the foreign keys demand.
 *
 * `files.user_id` and `folders.user_id` are plain UUID columns with no
 * reference to `auth.users` — only `profiles.id` and
 * `dropbox_connections.user_id` cascade. So deleting the account first would
 * strand every row and every byte it owns, invisibly: the rows stay, RLS keeps
 * matching them against a `auth.uid()` nobody will ever present again, and the
 * bytes stay paid for. The sweep in `api/demo/session.ts` learned this first
 * and this follows the same sequence.
 *
 * Every provider stores under a per-user prefix, which is what makes an erase
 * possible at all without walking the rows: `<userId>/` in Supabase Storage,
 * `users/<userId>/` in R2, and the folder `users/<userId>` plus the tag
 * `user_<userId>` in Cloudinary.
 *
 * What it deliberately cannot reach is Google Drive and Dropbox. Those files
 * live in the user's *own* cloud account, put there with their own OAuth
 * grant, and the app holds no standing authority to delete from either — the
 * Dropbox refresh token is erased along with the row that held it. Leaving a
 * person's files in a storage account they control is the right outcome, but
 * the interface has to say so rather than imply a clean sweep.
 */

export interface EraseDeps {
  supabase: SupabaseClient;
  /** Removes every R2 object under `users/<userId>/`. Absent where R2 is not configured. */
  eraseR2?: (userId: string) => Promise<void>;
  /** Removes every Cloudinary asset for the user. Absent where Cloudinary is not configured. */
  eraseCloudinary?: (userId: string) => Promise<void>;
}

export interface EraseResult {
  /** Providers that answered with an error. The account is still deleted. */
  failures: string[];
}

const BUCKET = 'files';

/** One page is 100; a full account can hold more than that. */
const LIST_PAGE = 100;

async function eraseSupabaseStorage(supabase: SupabaseClient, userId: string): Promise<void> {
  /* Paged rather than a single list() with a large limit: the API caps what it
     returns, and an account over that cap would be reported as fully erased
     while keeping everything past the first page. */
  for (;;) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(userId, { limit: LIST_PAGE, offset: 0 });
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return;

    const { error: removeError } = await supabase.storage
      .from(BUCKET)
      .remove(data.map((o) => `${userId}/${o.name}`));
    if (removeError) throw new Error(removeError.message);

    /* The offset stays at 0 on purpose — each pass removes what it listed, so
       the next page is whatever moved up into its place. */
    if (data.length < LIST_PAGE) return;
  }
}

/**
 * Deletes the account and everything under it.
 *
 * Storage failures are collected rather than thrown. A person who has asked to
 * be deleted must not be left with an account because one bucket was briefly
 * unreachable — the rows and the login go regardless, and what could not be
 * reached is reported so it can be swept later. A failure to delete the *user*
 * is different, and does throw: that is the part the request was actually for.
 */
export async function eraseAccount(userId: string, deps: EraseDeps): Promise<EraseResult> {
  const { supabase, eraseR2, eraseCloudinary } = deps;
  const failures: string[] = [];

  const providers: Array<[string, () => Promise<void>]> = [
    ['supabase_storage', () => eraseSupabaseStorage(supabase, userId)],
  ];
  if (eraseR2) providers.push(['r2', () => eraseR2(userId)]);
  if (eraseCloudinary) providers.push(['cloudinary', () => eraseCloudinary(userId)]);

  for (const [name, erase] of providers) {
    try {
      await erase();
    } catch (error) {
      failures.push(name);
      console.error(`Account erase: ${name} failed for ${userId}:`, error);
    }
  }

  /* Rows before the user, for the reason at the top of this file. shared_links
     cascades from files, and profiles and dropbox_connections cascade from the
     user, so those three are not named here. */
  const { error: filesError } = await supabase.from('files').delete().eq('user_id', userId);
  if (filesError) throw new Error(`Failed to delete files: ${filesError.message}`);

  const { error: foldersError } = await supabase.from('folders').delete().eq('user_id', userId);
  if (foldersError) throw new Error(`Failed to delete folders: ${foldersError.message}`);

  const { error: userError } = await supabase.auth.admin.deleteUser(userId);
  if (userError) throw new Error(`Failed to delete the account: ${userError.message}`);

  return { failures };
}
