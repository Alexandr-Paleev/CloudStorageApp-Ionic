import { supabase } from '../supabase/supabase.config';
import { User } from '@supabase/supabase-js';

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
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  },

  /**
   * Subscribe to auth state changes
   */
  onAuthStateChanged(callback: (user: User | null) => void): () => void {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      callback(session?.user ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  },
};












