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
 * Signs the app in with the code the callback carried, and with nothing else.
 *
 * The client runs the PKCE flow here (supabase/supabase.config.ts): a code
 * becomes a session only beside the verifier this app stored when the sign-in
 * began, so one that did not start here is refused — whether another app on
 * the device claimed the scheme and caught it, or a page linked to the scheme
 * with a code of its own. Tokens in the fragment were what the implicit flow
 * sent, and they were taken as they came: a link carrying someone else's
 * session would have signed the app into that account.
 */
async function adoptSessionFrom(url: string): Promise<void> {
  const code = new URL(url).searchParams.get('code');
  if (!code) return;

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw error;
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
