import { supabase } from '../supabase/supabase.config';
import { apiUrl } from '../utils/api.utils';

interface DemoSession {
  access_token: string;
  refresh_token: string;
}

/**
 * Opens a demo account and signs the browser into it.
 *
 * The server creates a throwaway account, seeds it and returns a session; the
 * client adopts it through setSession, which is the same store the ordinary
 * login writes to. AuthContext's onAuthStateChange then fires on its own, so
 * nothing here has to tell the rest of the app that a user appeared.
 */
export const demoService = {
  async start(): Promise<void> {
    const response = await fetch(apiUrl('/api/demo/session'), { method: 'POST' });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      throw new Error(body.message || 'Could not start a demo session');
    }

    const session = (await response.json()) as DemoSession;
    const { error } = await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });

    if (error) throw error;
  },
};

export default demoService;
