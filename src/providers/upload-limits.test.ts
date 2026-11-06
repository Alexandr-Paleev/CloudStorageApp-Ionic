import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { UPLOAD_LIMITS, fitsProvider } from './upload-limits';

describe('fitsProvider', () => {
  it('takes a file of exactly the limit, and refuses one byte more', () => {
    const limit = UPLOAD_LIMITS.cloudinary!;
    expect(fitsProvider('cloudinary', limit)).toBe(true);
    expect(fitsProvider('cloudinary', limit + 1)).toBe(false);
  });

  it('refuses nothing to a provider with no limit this app reaches', () => {
    const fiveTerabytes = 5 * 1024 ** 4;
    expect(fitsProvider('r2', fiveTerabytes)).toBe(true);
    expect(fitsProvider('googledrive', fiveTerabytes)).toBe(true);
  });
});

/* SQL cannot import a constant: migration 018 writes the bucket's ceiling a
   second time, and this is what notices when the two stop agreeing. */
describe('the limit of Supabase Storage', () => {
  it('is the ceiling migrations/018 sets on the bucket, 50 MB', () => {
    // From the root the suite runs in: under jsdom, import.meta.url is not a file.
    const migration = readFileSync(resolve('migrations/018_constrain_file_rows.sql'), 'utf8');

    expect(UPLOAD_LIMITS.supabase_storage).toBe(50 * 1024 * 1024);
    expect(migration).toContain(
      `SET file_size_limit = ${UPLOAD_LIMITS.supabase_storage} WHERE id = 'files'`
    );
  });
});
