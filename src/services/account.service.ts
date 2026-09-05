import { supabase } from '../supabase/supabase.config';
import { apiUrl } from '../utils/api.utils';

/** Providers whose bytes could not be reached. The account is gone regardless. */
export interface DeletionResult {
  failures: string[];
}

async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return {
    'Content-Type': 'application/json',
    ...(session?.access_token && { Authorization: `Bearer ${session.access_token}` }),
  };
}

const accountService = {
  /**
   * Deletes the signed-in account and everything under it. There is no undo.
   *
   * The local session is cleared afterwards rather than before: signing out
   * first would throw away the token the request needs to prove who is asking.
   * `signOut` is best-effort — the server has already destroyed the user by the
   * time it runs, so its own call may fail, and the account is no less deleted
   * for it.
   */
  async deleteAccount(): Promise<DeletionResult> {
    const response = await fetch(apiUrl('/api/account/delete'), {
      method: 'DELETE',
      headers: await authHeaders(),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message || 'Failed to delete the account');
    }

    const { failures = [] } = (await response.json()) as { failures?: string[] };

    await supabase.auth.signOut().catch(() => undefined);

    return { failures };
  },
};

export default accountService;
