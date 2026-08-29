import { supabase } from '../supabase/supabase.config';

export interface ShareLink {
  url: string;
  expiresAt: string;
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
