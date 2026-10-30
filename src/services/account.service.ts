import { supabase } from '../supabase/supabase.config';
import { apiUrl } from '../utils/api.utils';
import storageService from './storage.service';

/** Providers whose bytes could not be reached. The account is gone regardless. */
export interface DeletionResult {
  failures: string[];
}

function authHeaders(accessToken: string | undefined): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
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
   *
   * The uploads this device was keeping to finish later go the same way, and
   * for the same reason are best-effort: they hold the account's files, and
   * nobody can finish them now. The session is read once, before the request,
   * because after it there is no account left to refresh it for.
   */
  async deleteAccount(): Promise<DeletionResult> {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const response = await fetch(apiUrl('/api/account/delete'), {
      method: 'DELETE',
      headers: authHeaders(session?.access_token),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message || 'Failed to delete the account');
    }

    const { failures = [] } = (await response.json()) as { failures?: string[] };

    if (session) await storageService.forgetUploads(session.user.id).catch(() => undefined);
    await supabase.auth.signOut().catch(() => undefined);

    return { failures };
  },
};

export default accountService;
