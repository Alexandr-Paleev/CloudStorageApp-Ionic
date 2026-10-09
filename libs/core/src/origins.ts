/**
 * Where each of the two apps is served.
 *
 * They are different origins and different Vercel projects, on purpose:
 * decision 0014. Each needs to send people to the other, the site to the
 * app's login and the app to the site's legal pages, and an address typed
 * into both would be two copies of it.
 *
 * `vercel.json` is the third place the site's address has to appear: the
 * redirects from the app's old legal addresses are written there, and that
 * file cannot read this one. A test holds the two together.
 *
 * If the site moves to another domain, this is the line to change.
 */
export const SITE_ORIGIN = 'https://cloud-storage-web-xi.vercel.app';

export const APP_ORIGIN = 'https://cloud-storage-app-ionic-v0.vercel.app';
