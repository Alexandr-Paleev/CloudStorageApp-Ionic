import type { SupabaseClient } from '@supabase/supabase-js';
import { report } from './report';

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
 *
 * Everything an erase must do lives here, and not in a route that calls it.
 * Closing the Stripe customer lived in `DELETE /api/account` alone, and the
 * other caller, the demo sweep, erased accounts that had opened a checkout
 * and left their customers behind.
 */

export interface EraseDeps {
  supabase: SupabaseClient;
  /** Removes every R2 object under `users/<userId>/`. Absent where R2 is not configured. */
  eraseR2?: (userId: string) => Promise<void>;
  /** Removes every Cloudinary asset for the user. Absent where Cloudinary is not configured. */
  eraseCloudinary?: (userId: string) => Promise<void>;
  /**
   * Deletes a Stripe customer, which cancels its subscriptions at once. Throws
   * BillingNotClosed when Stripe would not; a customer already gone counts as
   * closed. Absent where billing is not configured.
   */
  closeBilling?: (customerId: string) => Promise<void>;
}

export interface EraseResult {
  /** Providers that answered with an error. The account is still deleted. */
  failures: string[];
}

/**
 * The account pays for something that could not be ended, so nothing of it
 * was erased. `status` is the answer a route gives: 503 when this deployment
 * holds no key to reach Stripe, 502 when Stripe did not do it.
 */
export class BillingNotClosed extends Error {
  constructor(
    message: string,
    readonly status: 502 | 503
  ) {
    super(message);
  }
}

const BUCKET = 'files';

/** One page is 100; a full account can hold more than that. */
const LIST_PAGE = 100;

/** Folders inside an account's folder, at most. The app writes none, and
 *  migrations/018 refuses one; this bounds an erase of what came before. */
const MAX_DEPTH = 8;

/** The account's Stripe customer, if it ever opened a checkout. */
async function stripeCustomerOf(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', userId)
    .limit(1);

  if (error) throw new Error(`Failed to read the profile: ${error.message}`);

  const rows = (data || []) as { stripe_customer_id: string | null }[];
  return rows[0]?.stripe_customer_id ?? null;
}

/**
 * Removes every object under `folder`, the folders in it included.
 *
 * Storage lists one level at a time, and an entry with no id is a folder:
 * the list of the account's folder alone left anything deeper in place, and
 * with a hundred folders at the top of a page, `remove` was handed folder
 * names, removed nothing, and the next pass listed the same page until the
 * function timed out.
 */
async function eraseFolder(supabase: SupabaseClient, folder: string, depth = 0): Promise<void> {
  if (depth > MAX_DEPTH) {
    throw new Error(`${folder} is nested more than ${MAX_DEPTH} folders deep`);
  }

  let previous = '';
  for (;;) {
    /* Paged rather than a single list() with a large limit: the API caps what
       it returns, and an account over that cap would be reported as fully
       erased while keeping everything past the first page. */
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(folder, { limit: LIST_PAGE, offset: 0 });
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return;

    /* The offset stays at 0 on purpose — each pass removes what it listed, so
       the next page is whatever moved up into its place. A pass that comes
       back with the same page made no progress, and asking again would not
       either. */
    const page = data.map((entry) => entry.name).join('/');
    if (page === previous) throw new Error(`could not empty ${folder}`);
    previous = page;

    for (const entry of data) {
      if (entry.id === null) await eraseFolder(supabase, `${folder}/${entry.name}`, depth + 1);
    }

    const objects = data.filter((entry) => entry.id !== null);
    if (objects.length > 0) {
      const { error: removeError } = await supabase.storage
        .from(BUCKET)
        .remove(objects.map((o) => `${folder}/${o.name}`));
      if (removeError) throw new Error(removeError.message);
    }

    if (data.length < LIST_PAGE) return;
  }
}

/**
 * Deletes the account and everything under it.
 *
 * Billing first, and on its own terms. What the account pays for ends before
 * anything of it is erased: the profile is the only link between the account
 * and its Stripe customer, the erase deletes it, and a subscription left
 * behind went on renewing with nothing in the app left to cancel it from. So
 * a customer that cannot be closed stops the erase, with nothing erased; an
 * account that is gone and still paying is worse than a deletion that has to
 * be asked for again.
 *
 * Storage failures are collected rather than thrown. A person who has asked to
 * be deleted must not be left with an account because one bucket was briefly
 * unreachable — the rows and the login go regardless, and what could not be
 * reached is reported so it can be swept later. A failure to delete the *user*
 * is different, and does throw: that is the part the request was actually for.
 */
export async function eraseAccount(userId: string, deps: EraseDeps): Promise<EraseResult> {
  const { supabase, eraseR2, eraseCloudinary, closeBilling } = deps;
  const failures: string[] = [];

  const customerId = await stripeCustomerOf(supabase, userId);
  if (customerId) {
    if (!closeBilling) {
      throw new BillingNotClosed(
        'Billing is not configured here, so it cannot be closed. Nothing was deleted.',
        503
      );
    }
    await closeBilling(customerId);
  }

  const providers: Array<[string, () => Promise<void>]> = [
    ['supabase_storage', () => eraseFolder(supabase, userId)],
  ];
  if (eraseR2) providers.push(['r2', () => eraseR2(userId)]);
  if (eraseCloudinary) providers.push(['cloudinary', () => eraseCloudinary(userId)]);

  for (const [name, erase] of providers) {
    try {
      await erase();
    } catch (error) {
      failures.push(name);
      console.error(`Account erase: ${name} failed for ${userId}:`, error);
      /* The account goes regardless, and what stayed behind has to be swept
         by hand: this is the one place that knows it is there. */
      await report(error, {
        route: 'account/erase',
        userId,
        level: 'warning',
        extra: { provider: name },
      });
    }
  }

  /* Rows before the user, for the reason at the top of this file. shared_links
     and file_embeddings cascade from files, and profiles and dropbox_connections
     cascade from the user, so those four are not named here. */
  const { error: filesError } = await supabase.from('files').delete().eq('user_id', userId);
  if (filesError) throw new Error(`Failed to delete files: ${filesError.message}`);

  const { error: foldersError } = await supabase.from('folders').delete().eq('user_id', userId);
  if (foldersError) throw new Error(`Failed to delete folders: ${foldersError.message}`);

  const { error: userError } = await supabase.auth.admin.deleteUser(userId);
  if (userError) throw new Error(`Failed to delete the account: ${userError.message}`);

  return { failures };
}
