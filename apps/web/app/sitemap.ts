import type { MetadataRoute } from 'next';
import { SITE_URL } from '../lib/site';

/* One page so far. Each page that joins this site joins this list. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${SITE_URL}/`, changeFrequency: 'monthly', priority: 1 }];
}
