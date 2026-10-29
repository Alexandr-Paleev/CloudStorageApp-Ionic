import { supabase } from '../supabase/supabase.config';
import type { AuthChangeEvent, User } from '@supabase/supabase-js';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { NATIVE_AUTH_CALLBACK } from '../native/deep-links';

export type AuthUser = User | null;

export const authService = {
  /**
   * Create an account with email and password. Resolves to whether it is
   * signed in: Supabase opens a session at once only where an address needs
   * no confirming. This project's does (`mailer_autoconfirm` is off), so a
   * new account stays signed out until the link sent to it has been opened.
   */
  async register(email: string, password: string): Promise<{ signedIn: boolean }> {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });
    if (error) throw error;
    if (!data.user) throw new Error('Registration failed');
    return { signedIn: Boolean(data.session) };
  },

  /**
   * Sign in with email and password
   */
  async login(email: string, password: string): Promise<User> {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    if (!data.user) throw new Error('Login failed');
    return data.user;
  },

  /**
   * Sign out current user
   */
  async logout(): Promise<void> {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  /**
   * Get current user
   */
  async getCurrentUser(): Promise<User | null> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  },

  /**
   * Subscribe to auth state changes. The event comes second, for whoever has
   * to tell signing out from never having signed in.
   */
  onAuthStateChanged(callback: (user: User | null, event: AuthChangeEvent) => void): () => void {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      callback(session?.user ?? null, event);
    });

    return () => {
      subscription.unsubscribe();
    };
  },

  /**
   * Sign in with Google OAuth
   */
  async signInWithGoogle(): Promise<void> {
    /* Two things differ on a device, and both follow from the page not having
       a real origin there. The address Google is asked to come back to is a
       custom scheme rather than a URL, and the sign-in page is opened in the
       system browser rather than in place: letting the WebView navigate to
       Google would replace the app with a web page it cannot come back from —
       and Google refuses to sign anyone in inside an embedded WebView anyway. */
    const native = Capacitor.isNativePlatform();

    /* No `access_type: 'offline'` and no `prompt: 'consent'`. Together they
       had Google issue a refresh token on every sign-in — a credential to the
       person's Drive that lasts until revoked — which Supabase handed to the
       browser and nothing here ever used; and they put the full consent
       screen in front of every sign-in, not only the first. The access token
       that comes with the session is all Drive is used with. */
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        scopes: 'openid email profile https://www.googleapis.com/auth/drive.file',
        redirectTo: native ? NATIVE_AUTH_CALLBACK : window.location.origin + '/dashboard',
        skipBrowserRedirect: native,
      },
    });
    if (error) throw error;

    if (native && data?.url) {
      await Browser.open({ url: data.url });
    }
  },
};
