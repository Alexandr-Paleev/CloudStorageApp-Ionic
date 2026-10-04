import { describe, it, expect } from 'vitest';
import { ownerPrefix, ownsStoredPath } from './stored-path';

const uid = '11111111-1111-1111-1111-111111111111';

describe('ownerPrefix', () => {
  it.each([
    ['cloudinary', `users/${uid}/`],
    ['r2', `users/${uid}/`],
    ['supabase_storage', `${uid}/`],
  ] as const)('puts %s objects under %s', (provider, prefix) => {
    expect(ownerPrefix(provider, uid)).toBe(prefix);
  });

  it('always ends in a slash', () => {
    // The slash is what keeps `users/<id>` from also matching `users/<id>0/`.
    for (const provider of ['cloudinary', 'r2', 'supabase_storage'] as const) {
      expect(ownerPrefix(provider, uid).endsWith('/')).toBe(true);
    }
  });
});

describe('ownsStoredPath', () => {
  it.each([
    ['cloudinary', `users/${uid}/holiday`],
    ['r2', `users/${uid}/holiday.png`],
    ['supabase_storage', `${uid}/1700000000_holiday.png`],
  ])('accepts the path %s actually writes', (storage_type, storage_path) => {
    expect(ownsStoredPath({ storage_type, storage_path }, uid)).toBe(true);
  });

  it.each([
    ['cloudinary', 'users/22222222-2222-2222-2222-222222222222/secret'],
    ['r2', 'users/22222222-2222-2222-2222-222222222222/secret.pdf'],
    ['supabase_storage', '22222222-2222-2222-2222-222222222222/secret.pdf'],
  ])("refuses another account's %s path", (storage_type, storage_path) => {
    // The row is written by the browser, and the routes that read it hold the
    // service-role key — nothing downstream would have stopped this.
    expect(ownsStoredPath({ storage_type, storage_path }, uid)).toBe(false);
  });

  it('keeps the trailing slash load-bearing', () => {
    // Without it `users/<id>` would authorise `users/<id>0/`.
    expect(ownsStoredPath({ storage_type: 'r2', storage_path: `users/${uid}0/x` }, uid)).toBe(
      false
    );
  });

  /* Each of these starts with the owner's own prefix, and each can name another
     object once a browser has parsed it as a URL. */
  it.each([
    ['r2', `users/${uid}/../22222222-2222-2222-2222-222222222222/secret.pdf`],
    ['supabase_storage', `${uid}/../22222222-2222-2222-2222-222222222222/secret.pdf`],
    ['cloudinary', `users/${uid}/./holiday`],
    ['r2', `users/${uid}/..`],
    ['r2', `users/${uid}/..\\22222222-2222-2222-2222-222222222222/secret.pdf`],
    ['r2', `users/${uid}/%2e%2e/22222222-2222-2222-2222-222222222222/secret.pdf`],
    ['supabase_storage', `${uid}/.\t./22222222-2222-2222-2222-222222222222/secret.pdf`],
    ['supabase_storage', `${uid}/x.pdf?y`],
    ['supabase_storage', `${uid}/x.pdf#y`],
  ])('refuses a %s path a URL parser would rewrite: %j', (storage_type, storage_path) => {
    expect(ownsStoredPath({ storage_type, storage_path }, uid)).toBe(false);
  });

  it.each([
    ['r2', `users/${uid}/1700000000000_report (final).pdf`],
    ['r2', `users/${uid}/1700000000000_отчёт.pdf`],
    ['supabase_storage', `${uid}/1700000000000_my.file.name.pdf`],
    ['supabase_storage', `${uid}/1700000000000_..pdf`],
  ])(
    'still accepts a %s name with dots, spaces or letters beyond ASCII: %j',
    (storage_type, storage_path) => {
      expect(ownsStoredPath({ storage_type, storage_path }, uid)).toBe(true);
    }
  );

  it('refuses a provider it does not know', () => {
    expect(ownsStoredPath({ storage_type: 'googledrive', storage_path: 'whatever' }, uid)).toBe(
      false
    );
  });
});
