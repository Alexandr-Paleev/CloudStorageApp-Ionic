import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { env } from '../env';

const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY;

/* In the native shell a sign-in comes back through a custom scheme
   (native/deep-links.ts), and any app on the device can claim a scheme. So
   there the flow is PKCE: what comes back is a code, which becomes a session
   only beside the verifier this app stored when the sign-in began, rather
   than the session itself. The WebView's own address is never the callback
   there, so it is not read for one.

   The web keeps the default, implicit flow for now. Its callback is the app's
   own https origin, which nothing else can claim. Moving it too touches the
   Dropbox callback, whose `?code=` the client would take for its own, the
   moment the collectors start (decision 0015), and a confirmation link opened
   on another device. */
export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  Capacitor.isNativePlatform() ? { auth: { flowType: 'pkce', detectSessionInUrl: false } } : {}
);
