import { describe, it, expect } from 'vitest';
import { FileMetadataSchema, FolderSchema, validateAndSanitizeName } from './file.schema';
import { MAX_NAME_LENGTH } from '@cloud-storage/core/file-rules';

const row = {
  name: 'report.pdf',
  size: 1024,
  type: 'application/pdf',
  download_url: 'https://project.supabase.co/storage/v1/object/sign/files/user-1/report.pdf',
  storage_path: 'user-1/1700000000_report.pdf',
  storage_type: 'supabase_storage',
  user_id: 'user-1',
};

describe('a file row', () => {
  /* `positive()` refused 0, after the upload, and the toast showed the
     schema's own JSON. An empty file is still a file. */
  it('keeps an empty file', () => {
    expect(FileMetadataSchema.parse({ ...row, size: 0 }).size).toBe(0);
  });

  it.each([-1, 1.5, Number.NaN])('refuses a size of %s, as the database does', (size) => {
    expect(FileMetadataSchema.safeParse({ ...row, size }).success).toBe(false);
  });

  it('refuses a provider the app does not have', () => {
    expect(FileMetadataSchema.safeParse({ ...row, storage_type: 'ftp' }).success).toBe(false);
  });

  it('takes a name at the limit and none past it, for files and for folders', () => {
    const atLimit = 'a'.repeat(MAX_NAME_LENGTH);
    const past = 'a'.repeat(MAX_NAME_LENGTH + 1);

    expect(FileMetadataSchema.safeParse({ ...row, name: atLimit }).success).toBe(true);
    expect(FileMetadataSchema.safeParse({ ...row, name: past }).success).toBe(false);
    expect(FolderSchema.safeParse({ name: atLimit }).success).toBe(true);
    expect(FolderSchema.safeParse({ name: past }).success).toBe(false);
  });
});

describe('validateAndSanitizeName', () => {
  /* The schemas are asked when a row is written. A rename went through this
     alone, and passed a name of any length on to the database. */
  it('refuses a name past the limit', () => {
    expect(() => validateAndSanitizeName('a'.repeat(MAX_NAME_LENGTH + 1))).toThrow(
      `A name can be at most ${MAX_NAME_LENGTH} characters`
    );
    expect(validateAndSanitizeName('a'.repeat(MAX_NAME_LENGTH))).toHaveLength(MAX_NAME_LENGTH);
  });
});
