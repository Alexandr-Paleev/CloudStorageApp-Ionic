import { describe, it, expect } from 'vitest';
import { cloudinaryUrlIsOwned, storedUrlIsOnItsProvider } from './stored-url';

const uid = '11111111-1111-1111-1111-111111111111';

describe('cloudinaryUrlIsOwned', () => {
  const good = `https://res.cloudinary.com/demo/image/upload/v1/users/${uid}/holiday.jpg`;

  it('accepts a delivery URL on Cloudinary’s host, in the caller’s folder', () => {
    expect(cloudinaryUrlIsOwned(good, uid)).toBe(true);
  });

  it.each([
    ['another account’s folder', `https://res.cloudinary.com/demo/image/upload/users/2222/x.jpg`],
    ['another host entirely', `https://evil.example/image/upload/users/${uid}/x.jpg`],
    [
      'a host that only begins with Cloudinary’s',
      `https://res.cloudinary.com.evil.example/users/${uid}/x`,
    ],
    [
      'the host Cloudinary gives one account for private delivery',
      `https://demo-res.cloudinary.com/image/upload/users/${uid}/x.jpg`,
    ],
    ['plain http', `http://res.cloudinary.com/demo/image/upload/users/${uid}/x.jpg`],
    ['an internal address', 'http://169.254.169.254/latest/meta-data/'],
    ['not a URL at all', 'users/' + uid + '/x.jpg'],
  ])('refuses %s', (_label, url) => {
    expect(cloudinaryUrlIsOwned(url, uid)).toBe(false);
  });

  /* Said here because the name could be read as more than it is. */
  it('does not ask which Cloudinary account the address is in', () => {
    const elsewhereOnCloudinary = `https://res.cloudinary.com/another/raw/upload/users/${uid}/x.pdf`;
    expect(cloudinaryUrlIsOwned(elsewhereOnCloudinary, uid)).toBe(true);
  });
});

describe('storedUrlIsOnItsProvider', () => {
  const stored = (storage_type: string, download_url: string) => ({ storage_type, download_url });
  const onDropbox = 'https://www.dropbox.com/s/abc/report.pdf?raw=1';

  it.each([
    ['cloudinary', `https://res.cloudinary.com/demo/image/upload/v1/users/${uid}/holiday.jpg`],
    ['dropbox', onDropbox],
    ['dropbox', 'https://www.dropbox.com/scl/fi/abc/report.pdf?raw=1'],
    ['googledrive', 'https://drive.google.com/file/d/abc/view?usp=drivesdk'],
  ])('accepts what an upload to %s stores', (provider, url) => {
    expect(storedUrlIsOnItsProvider(stored(provider, url), uid)).toBe(true);
  });

  /* Each provider is held to its own host, and not to any host on the list. */
  it.each([
    ['a Dropbox address on a Cloudinary row', 'cloudinary', onDropbox],
    [
      'a Cloudinary address on a Dropbox row',
      'dropbox',
      `https://res.cloudinary.com/demo/raw/upload/v1/users/${uid}/report.pdf`,
    ],
    ['a Dropbox address on a Drive row', 'googledrive', onDropbox],
    ['a Drive address on a Dropbox row', 'dropbox', 'https://drive.google.com/file/d/abc/view'],
  ])('refuses %s', (_what, provider, url) => {
    expect(storedUrlIsOnItsProvider(stored(provider, url), uid)).toBe(false);
  });

  /* The last of these is what the Dropbox upload falls back to when it is
     given no shared link: a path in the user's Dropbox, which no browser can
     be sent to. */
  it.each([
    ['another site', 'https://elsewhere.example/s/abc/report.pdf?raw=1'],
    [
      'a host that only begins with Dropbox’s',
      'https://www.dropbox.com.elsewhere.example/s/abc/report.pdf',
    ],
    ['another host under Dropbox’s name', 'https://files.dropbox.com/s/abc/report.pdf'],
    ['Dropbox’s name in a path', 'https://elsewhere.example/www.dropbox.com/s/abc/report.pdf'],
    ['Dropbox’s name in a query string', 'https://elsewhere.example/?to=https://www.dropbox.com/'],
    ['Dropbox’s name where a sign-in name goes', 'https://www.dropbox.com@elsewhere.example/s/abc'],
    ['plain http', 'http://www.dropbox.com/s/abc/report.pdf?raw=1'],
    ['a script', 'javascript:alert(1)'],
    ['a path', '/CloudStorage/user/1700000000000_report.pdf'],
    ['nothing', ''],
  ])('refuses a Dropbox row stored at %s', (_what, url) => {
    expect(storedUrlIsOnItsProvider(stored('dropbox', url), uid)).toBe(false);
  });

  /* What these two store is a signature that ran out long ago. Nothing hands
     it out: the path is signed again, by `signOwnedPath`. */
  it.each([
    [
      'r2',
      `https://account.r2.cloudflarestorage.com/bucket/users/${uid}/report.pdf?X-Amz-Expires=3600`,
    ],
    [
      'supabase_storage',
      `https://project.supabase.co/storage/v1/object/sign/files/${uid}/report.pdf`,
    ],
  ])('has no address to accept for %s, whose path is signed instead', (provider, url) => {
    expect(storedUrlIsOnItsProvider(stored(provider, url), uid)).toBe(false);
  });

  /* The provider is the row's writing too, so it can be any text at all. The
     middle three are names every object answers to. */
  it.each(['somewhere', '', 'constructor', '__proto__', 'toString', 'Dropbox', ' dropbox'])(
    'refuses a provider it has not heard of: %j',
    (provider) => {
      expect(storedUrlIsOnItsProvider(stored(provider, onDropbox), uid)).toBe(false);
    }
  );
});
