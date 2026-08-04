import { describe, it, expect } from 'vitest';
import { toDirectLink } from './dropbox.utils';

describe('toDirectLink', () => {
  it('turns a Dropbox preview link into a direct one', () => {
    expect(toDirectLink('https://www.dropbox.com/scl/fi/abc/report.pdf?rlkey=xyz&dl=0')).toBe(
      'https://www.dropbox.com/scl/fi/abc/report.pdf?rlkey=xyz&raw=1'
    );
  });

  it('adds raw=1 even when the link has no dl parameter', () => {
    expect(toDirectLink('https://www.dropbox.com/s/abc/photo.jpg')).toBe(
      'https://www.dropbox.com/s/abc/photo.jpg?raw=1'
    );
  });

  it('replaces an existing raw value rather than duplicating it', () => {
    expect(toDirectLink('https://www.dropbox.com/s/abc/photo.jpg?raw=0')).toBe(
      'https://www.dropbox.com/s/abc/photo.jpg?raw=1'
    );
  });

  it('passes through a value that is not a URL', () => {
    // The upload falls back to path_display when no shared link comes back
    expect(toDirectLink('/CloudStorage/user-id/file.pdf')).toBe('/CloudStorage/user-id/file.pdf');
  });
});
