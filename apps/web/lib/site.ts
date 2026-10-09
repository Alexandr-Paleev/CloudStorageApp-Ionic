/**
 * Where this site lives, and where it sends people.
 *
 * Neither address is typed in by hand. Vercel gives every build the
 * production host of its own project, and that is this site's address: it
 * is what the canonical link, the sitemap and the social card point at, on a
 * preview as much as in production. Off Vercel there is no such host, and
 * the site says where it is running instead.
 */
const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;

export const SITE_URL = productionHost
  ? `https://${productionHost}`
  : `http://localhost:${process.env.PORT ?? 3000}`;

/** Only the production deployment asks to be indexed. A preview is a draft. */
export const IS_PRODUCTION = process.env.VERCEL_ENV === 'production';

/**
 * The app is a different origin and a different Vercel project: decision 0014.
 * The variable is for pointing a local build at a local app.
 */
export const APP_ORIGIN = (
  process.env.NEXT_PUBLIC_APP_ORIGIN ?? 'https://cloud-storage-app-ionic-v0.vercel.app'
).replace(/\/$/, '');

export const REPOSITORY_URL = 'https://github.com/Alexandr-Paleev/CloudStorageApp-Ionic';

export const SITE_NAME = 'Cloud Storage';

export const SITE_DESCRIPTION =
  'Open-source cloud storage that runs in a browser and installs as an app: folders, ' +
  'previews, and share links that expire and can be taken back. Try it without signing up.';
