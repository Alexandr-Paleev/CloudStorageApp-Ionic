import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { APP_ORIGIN, SITE_ORIGIN } from './origins';

interface Redirect {
  source: string;
  destination: string;
  permanent?: boolean;
}

/* The app's old legal addresses are redirected in vercel.json, which cannot
   import a constant. So the site's address is written there a second time,
   and this is what notices if the two stop agreeing. */
const redirects = (
  JSON.parse(readFileSync(new URL('../../../vercel.json', import.meta.url), 'utf8')) as {
    redirects?: Redirect[];
  }
).redirects;

describe('the two origins', () => {
  it('are two origins, and nothing more than origins', () => {
    expect(new URL(SITE_ORIGIN).origin).toBe(SITE_ORIGIN);
    expect(new URL(APP_ORIGIN).origin).toBe(APP_ORIGIN);
    expect(SITE_ORIGIN).not.toBe(APP_ORIGIN);
  });
});

describe("the app's old legal addresses", () => {
  it('all lead to the site, and to one of its two legal pages', () => {
    expect(redirects?.length).toBeGreaterThan(0);

    for (const { destination } of redirects ?? []) {
      expect([`${SITE_ORIGIN}/terms`, `${SITE_ORIGIN}/privacy`]).toContain(destination);
    }
  });

  it('cover the routes the app had and the static pages it served', () => {
    expect((redirects ?? []).map(({ source }) => source).sort()).toEqual(
      [
        '/privacy',
        '/privacy-policy',
        '/privacy-policy.html',
        '/terms',
        '/terms-of-service',
        '/terms-of-service.html',
      ].sort()
    );
  });

  it('are not permanent, because the address of the site may still change', () => {
    for (const { permanent } of redirects ?? []) expect(permanent).toBe(false);
  });
});
