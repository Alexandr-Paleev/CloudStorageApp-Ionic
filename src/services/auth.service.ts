import { supabase } from '../supabase/supabase.config';
import { User } from '@supabase/supabase-js';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { NATIVE_AUTH_CALLBACK } from '../native/deep-links';

export type AuthUser = User | null;

export const authService = {
  /**
   * Register a new user with email and password
   */
  async register(email: string, password: string): Promise<User> {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });
    if (error) throw error;
    if (!data.user) throw new Error('Registration failed');
    return data.user;
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
   * Subscribe to auth state changes
   */
  onAuthStateChanged(callback: (user: User | null) => void): () => void {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      callback(session?.user ?? null);
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

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
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
