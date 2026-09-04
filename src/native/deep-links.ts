import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { supabase } from '../supabase/supabase.config';

/**
 * Where Supabase sends the browser back to once Google has answered, on a
 * device.
 *
 * On the web that address is a page — `origin + '/dashboard'` — and the
 * WebView, Supabase and Google all agree what it means. In the shell there is
 * no origin worth naming: the page is served from `capacitor://localhost`,
 * which Google will not accept as a redirect target and Supabase will not
 * accept as a redirect URL. A custom scheme is the address the operating
 * system understands instead — iOS hands the callback to this app, and the
 * listener below turns it into a session.
 *
 * Registered in `ios/App/App/Info.plist` under `CFBundleURLTypes`, and it has
 * to be on the allow-list in Supabase → Authentication → URL Configuration.
 */
export const NATIVE_AUTH_CALLBACK = 'com.cloudstorage.app://auth/callback';

/**
 * Reads whatever the callback carried and signs the app in with it.
 *
 * Both shapes are handled on purpose. The client's default flow is implicit,
 * which puts the tokens in the fragment; switching it to PKCE — which a native
 * app should eventually do — moves them to a `code` query parameter instead,
 * and this keeps working across that change rather than failing at the one
 * moment nobody is watching.
 */
async function adoptSessionFrom(url: string): Promise<void> {
  const parsed = new URL(url);

  const code = parsed.searchParams.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return;
  }

  const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  const access_token = fragment.get('access_token');
  const refresh_token = fragment.get('refresh_token');
  if (access_token && refresh_token) {
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error) throw error;
  }
}

/**
 * Starts listening for the OAuth callback. No-op in a browser.
 *
 * Nothing here navigates: `AuthContext` is subscribed to `onAuthStateChange`,
 * so a session arriving is already the signal the rest of the app watches for,
 * and `PrivateRoute` lets the user through on the next render.
 */
export function initDeepLinks(): void {
  if (!Capacitor.isNativePlatform()) return;

  void App.addListener('appUrlOpen', async ({ url }) => {
    if (!url.startsWith(NATIVE_AUTH_CALLBACK)) return;

    /* Close the system browser first. Leaving it up over a signed-in app is
       how a person ends up tapping Sign in with Google a second time. */
    await Browser.close().catch(() => {
      /* Already gone, on the platforms that dismiss it themselves. */
    });

    await adoptSessionFrom(url);
  });
}
