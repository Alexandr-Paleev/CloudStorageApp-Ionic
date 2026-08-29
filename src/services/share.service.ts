import { supabase } from '../supabase/supabase.config';

export interface ShareLink {
  url: string;
  expiresAt: string;
}

/** A link as the owner sees it: no token — the server stores only its hash. */
export interface ShareLinkRecord {
  id: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
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

const shareService = {
  /**
   * Mints a public link. The token comes back exactly once — the server keeps
   * only its hash, so a lost link cannot be recovered, only replaced.
   */
  async createLink(fileId: string, expiresInDays?: number): Promise<ShareLink> {
    const response = await fetch('/api/share', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ fileId, expiresInDays }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message || 'Failed to create share link');
    }

    return (await response.json()) as ShareLink;
  },

  /**
   * Links the caller created for one file.
   *
   * Read straight from the table: the "Users can view their own shared links"
   * policy scopes it to created_by = auth.uid(), and the row carries no token —
   * only its hash, which is not selected here.
   */
  async listLinks(fileId: string): Promise<ShareLinkRecord[]> {
    const { data, error } = await supabase
      .from('shared_links')
      .select('id, created_at, expires_at, revoked_at')
      .eq('file_id', fileId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []) as ShareLinkRecord[];
  },

  async revokeLink(id: string): Promise<void> {
    const response = await fetch(`/api/share?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: await authHeaders(),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message || 'Failed to revoke share link');
    }
  },
};

export default shareService;
