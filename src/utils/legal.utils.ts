import { SITE_ORIGIN } from '@cloud-storage/core/origins';

/**
 * Where the terms and the privacy policy are: on the site, not in the app.
 * Decision 0014. The app links to them and holds no copy.
 */
export const LEGAL_URL = {
  terms: `${SITE_ORIGIN}/terms`,
  privacy: `${SITE_ORIGIN}/privacy`,
} as const;

export type LegalDocument = keyof typeof LEGAL_URL;
