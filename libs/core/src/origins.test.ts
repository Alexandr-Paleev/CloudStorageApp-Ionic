import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { APP_ORIGIN, SITE_ORIGIN } from './origins';
import { shareLinkUrl } from './share-link';

interface Redirect {
  source: string;
  destination: string;
  permanent?: boolean;
}

/* The addresses the app has handed on to the site are redirected in
   vercel.json, which cannot import a constant. So the site's address is
   written there a second time, and this is what notices if the two stop
   agreeing. */
const redirects =
  (
    JSON.parse(readFileSync(new URL('../../../vercel.json', import.meta.url), 'utf8')) as {
      redirects?: Redirect[];
    }
  ).redirects ?? [];

/* Vercel's own way of writing "whatever is here" in a redirect. */
const ANY_TOKEN = ':token';

const share = redirects.filter(({ source }) => source.startsWith('/s/'));
const legal = redirects.filter(({ source }) => !source.startsWith('/s/'));

describe('the two origins', () => {
  it('are two origins, and nothing more than origins', () => {
    expect(new URL(SITE_ORIGIN).origin).toBe(SITE_ORIGIN);
    expect(new URL(APP_ORIGIN).origin).toBe(APP_ORIGIN);
    expect(SITE_ORIGIN).not.toBe(APP_ORIGIN);
  });
});

describe('what the app redirects to the site', () => {
  it('is all on the site', () => {
    expect(redirects.length).toBeGreaterThan(0);

    for (const { destination } of redirects) {
      expect(new URL(destination).origin).toBe(SITE_ORIGIN);
    }
  });

  it('is not redirected for good, because the address of the site may still change', () => {
    for (const { permanent } of redirects) expect(permanent).toBe(false);
  });
});

describe("the app's old legal addresses", () => {
  it('all lead to one of the two legal pages', () => {
    for (const { destination } of legal) {
      expect([`${SITE_ORIGIN}/terms`, `${SITE_ORIGIN}/privacy`]).toContain(destination);
    }
  });

  it('cover the routes the app had and the static pages it served', () => {
    expect(legal.map(({ source }) => source).sort()).toEqual(
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
});

/* A link issued while the app opened links itself keeps the app's address
   for as long as it lives, which can be a year. */
describe('the address the app used to open a share link at', () => {
  it('leads to the same token, where a link is opened now', () => {
    expect(share).toEqual([
      { source: `/s/${ANY_TOKEN}`, destination: shareLinkUrl(ANY_TOKEN), permanent: false },
    ]);
  });
});
