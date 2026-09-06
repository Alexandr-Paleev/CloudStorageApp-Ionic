import { describe, it, expect } from 'vitest';
import { isSafeHttpUrl } from './safe-url';

describe('isSafeHttpUrl', () => {
  it('accepts the delivery URLs the providers actually return', () => {
    for (const url of [
      'https://res.cloudinary.com/demo/image/upload/v1/users/u1/photo.png',
      'https://pub-abc.r2.dev/users/u1/report.pdf?X-Amz-Signature=deadbeef&X-Amz-Expires=3600',
      'https://project.supabase.co/storage/v1/object/sign/files/u1/a.txt?token=eyJhbGciOi',
      'http://localhost:54321/storage/v1/object/public/files/u1/a.txt',
    ]) {
      expect(isSafeHttpUrl(url), url).toBe(true);
    }
  });

  /* The whole point: a value a user can write into their own row and then hand
     to someone else through a share link. */
  it('refuses schemes that execute', () => {
    for (const url of [
      'javascript:alert(document.cookie)',
      'JavaScript:alert(1)',
      // Leading whitespace and control characters are stripped by the parser,
      // which is exactly why this is a scheme allowlist and not a substring
      // check for the word "javascript".
      '  javascript:alert(1)',
      '\tjava\nscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'blob:https://evil.test/1234',
      'file:///etc/passwd',
    ]) {
      expect(isSafeHttpUrl(url), url).toBe(false);
    }
  });

  it('refuses anything that is not a URL at all', () => {
    for (const value of ['', '   ', 'not a url', '/users/u1/a.png', '//evil.test/a.png']) {
      expect(isSafeHttpUrl(value), JSON.stringify(value)).toBe(false);
    }
  });
});
