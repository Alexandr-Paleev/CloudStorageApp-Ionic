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

function parseEnv(): Env {
  try {
    return envSchema.parse(import.meta.env);
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
