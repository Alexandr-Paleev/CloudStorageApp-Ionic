import { Capacitor } from '@capacitor/core';
import { APP_ORIGIN } from '@cloud-storage/core/origins';
import { supabase } from '../supabase/supabase.config';
import { NEW_PASSWORD_PATH } from '../utils/password-reset.utils';
import { env } from '../env';

/**
 * The two calls behind the two steps of a forgotten password
 * (PasswordReset.tsx).
 *
 * Apart from auth.service on purpose: that one is in the first download, for
 * the login page, and these are wanted only on a page few people open.
 */
export const passwordResetService = {
  /**
   * Sends a link to choose a new password, if an account uses this address.
   *
   * Supabase answers the same whether one does or not, so the answer says
   * nothing about which addresses have accounts, and nothing that shows it may
   * either.
   *
   * The link comes back to the page that asks for the new password, with a
   * session for the account in its fragment: the web's implicit flow, which
   * works in whatever browser the mail is opened in. From the native shell it
   * comes back to the web app too. The shell has no address a mail can open,
   * and its client asks for PKCE, whose code becomes a session only beside the
   * verifier the app kept, while the link opens in a browser. So the shell asks
   * without one, by hand, and the new password is chosen on the web.
   */
  async requestLink(email: string): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + NEW_PASSWORD_PATH,
      });
      if (error) throw error;
      return;
    }

    const redirectTo = encodeURIComponent(APP_ORIGIN + NEW_PASSWORD_PATH);
    const response = await fetch(
      `${env.VITE_SUPABASE_URL}/auth/v1/recover?redirect_to=${redirectTo}`,
      {
        method: 'POST',
        headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      }
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { msg?: string };
      throw new Error(body.msg || 'Could not send the link');
    }
  },

  /**
   * Sets the signed-in account's password. The last step of a reset, where
   * the session is the one the link brought.
   */
  async setNewPassword(password: string): Promise<void> {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
  },
};
