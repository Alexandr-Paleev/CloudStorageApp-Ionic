import { z } from 'zod';

const envSchema = z.object({
  // Supabase - Required
  VITE_SUPABASE_URL: z.string().url('Invalid Supabase URL'),
  VITE_SUPABASE_ANON_KEY: z.string().min(1, 'Supabase anon key is required'),

  // Cloudinary - Optional
  VITE_CLOUDINARY_CLOUD_NAME: z.string().optional(),
  VITE_CLOUDINARY_API_KEY: z.string().optional(),
  VITE_CLOUDINARY_UPLOAD_PRESET: z.string().optional(),
  VITE_CLOUDINARY_DELETE_API_URL: z.string().url().optional(),

  // Cloudflare R2 - Optional
  VITE_R2_ACCOUNT_ID: z.string().optional(),
  VITE_R2_ACCESS_KEY_ID: z.string().optional(),
  VITE_R2_SECRET_ACCESS_KEY: z.string().optional(),
  VITE_R2_BUCKET_NAME: z.string().optional(),
  VITE_R2_PUBLIC_BUCKET_URL: z.string().url().optional(),

  // Google Drive - Optional
  VITE_GOOGLE_CLIENT_ID: z.string().optional(),

  // Sentry - Optional
  VITE_SENTRY_DSN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validated environment variables
 * Throws error on app startup if required variables are missing or invalid
 */
export const env: Env = envSchema.parse(import.meta.env);
