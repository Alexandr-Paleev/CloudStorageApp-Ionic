import { z } from 'zod';

const envSchema = z.object({
  // Supabase - Required
  VITE_SUPABASE_URL: z.string().url('Invalid Supabase URL'),
  VITE_SUPABASE_ANON_KEY: z.string().min(1, 'Supabase anon key is required'),

  // Cloudinary - Optional (API key/secret are server-side only, never VITE_)
  VITE_CLOUDINARY_CLOUD_NAME: z.string().optional(),
  VITE_CLOUDINARY_DELETE_API_URL: z.string().url().optional(),

  // Cloudflare R2 - Optional (credentials are server-side only)
  VITE_R2_BUCKET_NAME: z.string().optional(),

  /**
   * Where the app's own API routes live, for a build whose page is not served
   * from the same origin as its functions — that is, the iOS and Android
   * shells, where the WebView loads from `capacitor://localhost`. Ignored on
   * the web, where a relative path already reaches them; see utils/api.utils.
   */
  VITE_API_ORIGIN: z.string().url().optional(),

  // Google Drive - Optional
  VITE_GOOGLE_CLIENT_ID: z.string().optional(),

  // Sentry - Optional
  VITE_SENTRY_DSN: z.string().optional(),

  // Analytics - Optional
  VITE_GA4_MEASUREMENT_ID: z.string().optional(),
  VITE_HOTJAR_SITE_ID: z.string().optional(),
  VITE_HOTJAR_VERSION: z.coerce.number().optional().default(6),

  /**
   * Billing is hidden unless the environment actually has Stripe configured.
   * Defaults to off so a deployment without STRIPE_* keys never shows a buy
   * button that would answer with a 500.
   */
  VITE_BILLING_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .default('false')
    .transform((value) => value === 'true'),

  /**
   * Whether this deployment may offer search by meaning.
   *
   * Off by default, and for the same reason as VITE_BILLING_ENABLED above: a
   * clone with no model keys would otherwise show a mode that answers 501,
   * and an error carrying the names of environment variables reads as a
   * half-finished project rather than as a feature nobody switched on. The
   * server decides for itself too — `/api/ai/*` answers 501 whatever this
   * says — so a flag left on by mistake is untidy rather than dangerous.
   */
  VITE_SMART_SEARCH_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .default('false')
    .transform((value) => value === 'true'),

  /**
   * Set where Stripe runs on test keys. Real cards are declined there, so the
   * plans page has to say so — otherwise the page reads as a live storefront
   * taking money it will never charge.
   */
  VITE_BILLING_DEMO_MODE: z
    .enum(['true', 'false'])
    .optional()
    .default('false')
    .transform((value) => value === 'true'),

  /**
   * Shows "Try the demo" on the login page. Off by default, and paired with a
   * server-side DEMO_ENABLED that /api/demo/session checks for itself — a
   * client flag alone would only hide the button, not close the route, and a
   * route that creates accounts is not something to leave open by accident.
   */
  VITE_DEMO_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .default('false')
    .transform((value) => value === 'true'),

  // Dropbox - Optional (Pro feature)
  VITE_DROPBOX_APP_KEY: z.string().optional(),
  VITE_DROPBOX_REDIRECT_URI: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * What the build was given, one variable at a time.
 *
 * Each is read by its name, and `import.meta.env` is never handed over whole.
 * Shown a name, Vite writes that variable's value into the bundle. Shown the
 * object, it writes out every variable the build was given, whoever gave it.
 * Vercel gives a Vite build fourteen of its own, the id and the message of
 * the commit among them, and all of them were in the public bundle. They
 * differ from one deployment to the next, so the files that held them took a
 * new name every time. Measured on 2026-10-10 that was 16 of the 44 files
 * under `assets/`, and a new service worker for every returning visitor,
 * after a merge that had not touched the app.
 *
 * The type keeps this list and the schema the same list: a key the schema
 * has and this lacks does not compile, and neither does one the schema has
 * not. What the type cannot see is the right-hand side, so `env.test.ts`
 * holds every line to the name it is written under. Lint refuses the whole
 * object anywhere in the code that ships.
 */
const given: Record<keyof z.input<typeof envSchema>, unknown> = {
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
  VITE_CLOUDINARY_CLOUD_NAME: import.meta.env.VITE_CLOUDINARY_CLOUD_NAME,
  VITE_CLOUDINARY_DELETE_API_URL: import.meta.env.VITE_CLOUDINARY_DELETE_API_URL,
  VITE_R2_BUCKET_NAME: import.meta.env.VITE_R2_BUCKET_NAME,
  VITE_API_ORIGIN: import.meta.env.VITE_API_ORIGIN,
  VITE_GOOGLE_CLIENT_ID: import.meta.env.VITE_GOOGLE_CLIENT_ID,
  VITE_SENTRY_DSN: import.meta.env.VITE_SENTRY_DSN,
  VITE_GA4_MEASUREMENT_ID: import.meta.env.VITE_GA4_MEASUREMENT_ID,
  VITE_HOTJAR_SITE_ID: import.meta.env.VITE_HOTJAR_SITE_ID,
  VITE_HOTJAR_VERSION: import.meta.env.VITE_HOTJAR_VERSION,
  VITE_BILLING_ENABLED: import.meta.env.VITE_BILLING_ENABLED,
  VITE_SMART_SEARCH_ENABLED: import.meta.env.VITE_SMART_SEARCH_ENABLED,
  VITE_BILLING_DEMO_MODE: import.meta.env.VITE_BILLING_DEMO_MODE,
  VITE_DEMO_ENABLED: import.meta.env.VITE_DEMO_ENABLED,
  VITE_DROPBOX_APP_KEY: import.meta.env.VITE_DROPBOX_APP_KEY,
  VITE_DROPBOX_REDIRECT_URI: import.meta.env.VITE_DROPBOX_REDIRECT_URI,
};

function parseEnv(): Env {
  try {
    return envSchema.parse(given);
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
        : 'Unknown validation error';
    throw new Error(`Environment configuration error: ${message}`);
  }
}

/**
 * Validated environment variables
 * Throws a human-readable error on startup if required variables are missing
 */
export const env: Env = parseEnv();
