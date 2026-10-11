import { describe, expect, it } from 'vitest';
import { SITE_ORIGIN } from '@cloud-storage/core/origins';
import { movedShareLink } from './share-link.utils';

describe('a share link that arrives at the app', () => {
  it('has the same token on the site', () => {
    expect(movedShareLink('/s/abc_DEF-123')).toBe(`${SITE_ORIGIN}/s/abc_DEF-123`);
  });

  it('is still one with a slash after it', () => {
    expect(movedShareLink('/s/abc/')).toBe(`${SITE_ORIGIN}/s/abc`);
  });

  /* The address is already written the way an address writes it. Escaping
     it again would hand the site a different token. */
  it('is passed on as the address wrote it', () => {
    expect(movedShareLink('/s/a%20b')).toBe(`${SITE_ORIGIN}/s/a%20b`);
  });

  it.each([
    ['the dashboard', '/dashboard'],
    ['the first page', '/'],
    ['/s with nothing after it', '/s/'],
    ['/s alone', '/s'],
    ['something under a token', '/s/abc/def'],
    ['an address that only starts the same', '/settings/abc'],
    ['a file page', '/file/s/abc'],
  ])('is not what %s is', (_what, pathname) => {
    expect(movedShareLink(pathname)).toBeNull();
  });

  /* Whatever is in the address, it is a page of the site that it leads to.
     A token cannot name another host. */
  it.each(['/s/%2F%2Fevil.example', '/s/@evil.example', '/s/evil.example%2F..'])(
    'leads to the site and nowhere else: %s',
    (pathname) => {
      const moved = movedShareLink(pathname);

      expect(moved).not.toBeNull();
      expect(new URL(moved!).origin).toBe(SITE_ORIGIN);
      expect(new URL(moved!).pathname.startsWith('/s/')).toBe(true);
    }
  );
});
