import { describe, expect, it } from 'vitest';
import { SITE_ORIGIN } from './origins';
import { shareLinkUrl } from './share-link';

describe('the address of a share link', () => {
  it('is on the site, at /s/ and the token', () => {
    expect(shareLinkUrl('abc_DEF-123')).toBe(`${SITE_ORIGIN}/s/abc_DEF-123`);
  });

  /* The app passes on what it read off its own address, where a token that
     needed escaping is already escaped. Escaping it again would send the
     site a different token. */
  it('puts the token in as it is given, and does not escape it twice', () => {
    expect(shareLinkUrl('a%20b')).toBe(`${SITE_ORIGIN}/s/a%20b`);
  });
});
