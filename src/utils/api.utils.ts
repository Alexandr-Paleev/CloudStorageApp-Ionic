import { Capacitor } from '@capacitor/core';

/**
 * The URL of one of the app's own API routes.
 *
 * On the web this is the path it was handed, unchanged: the page and the
 * functions are served from the same deployment, so `/api/share` already
 * reaches them, and a preview deployment calls its own copy rather than
 * production's.
 *
 * The native shells cannot do that. A Capacitor WebView serves the page from
 * `capacitor://localhost`, and a relative path resolves against *that* — a
 * local file server with no `/api` in it, which answers 404. So every call
 * there has to name a deployment out loud, and `VITE_API_ORIGIN` is where it
 * is named.
 *
 * The platform check rather than the variable alone is what lets one build
 * serve both: `npm run build` produces the bundle the browser downloads and the
 * bundle Capacitor copies into the app, and only the second one should be
 * talking to another origin.
 *
 * Read straight off `import.meta.env`, as the Cloudinary delete URL beside it
 * is: `env.ts` validates the variable and documents it, but importing the
 * validated object here would drag Zod's whole-environment parse into every
 * module that makes an API call, and into their tests with it.
 */
export function apiUrl(path: string): string {
  if (!Capacitor.isNativePlatform()) return path;

  const origin = import.meta.env.VITE_API_ORIGIN;
  if (!origin) return path;

  return origin.replace(/\/+$/, '') + path;
}
