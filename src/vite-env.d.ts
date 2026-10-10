/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/**
 * Only what the app actually reads through `import.meta.env` directly. Everything
 * else goes through the Zod schema in src/env.ts, which is the source of truth
 * for shape and validation — this file is not a second inventory of variables.
 *
 * Nothing secret belongs here, and nothing secret belongs in a VITE_ variable at
 * all: Vite writes the value of every VITE_ variable the code names into the
 * public bundle. While env.ts handed it `import.meta.env` whole, it wrote the
 * ones no code names as well. Server-side credentials go in api/ without the
 * prefix.
 */
interface ImportMetaEnv {
  readonly VITE_CLOUDINARY_CLOUD_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
