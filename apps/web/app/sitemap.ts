import type { MetadataRoute } from 'next';
import { SITE_URL } from '../lib/site';

/* Each page that joins this site joins this list. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, changeFrequency: 'monthly', priority: 1 },
    { url: `${SITE_URL}/pricing`, changeFrequency: 'monthly', priority: 0.8 },
  ];
}
