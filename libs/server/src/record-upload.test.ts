import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockSupabase, type TableAnswer } from './test-utils';

const { db } = vi.hoisted(() => ({
  db: { client: null as { from: (table: string) => unknown } | null },
}));

vi.mock('./auth', () => ({
  supabase: { from: (table: string) => db.client!.from(table) },
}));

import { QuotaExceeded, UnknownFolder, readUploadDescription, recordUpload } from './record-upload';

const FOLDER = '3f2b8c1e-4d5a-4e6f-8a9b-0c1d2e3f4a5b';

describe('readUploadDescription', () => {
  it('takes a name, a type and a folder', () => {
    expect(
      readUploadDescription({ name: 'lease.pdf', type: 'application/pdf', folderId: FOLDER })
    ).toEqual({ description: { name: 'lease.pdf', type: 'application/pdf', folderId: FOLDER } });
  });

  it('files a file with no folder at the root, and one with no type as untyped', () => {
    expect(readUploadDescription({ name: 'notes' })).toEqual({
      description: { name: 'notes', type: '', folderId: null },
    });
  });

  it.each([
    [{}, 'name is required'],
    [{ name: '   ' }, 'name is required'],
    [{ name: 'a'.repeat(256) }, 'A name can be at most 255 characters'],
    [{ name: 'x', type: 7 }, 'type must be a MIME type'],
    [{ name: 'x', folderId: 'not-a-folder' }, 'folderId must be a folder id or null'],
  ])('refuses %j', (body, problem) => {
    expect(readUploadDescription(body)).toEqual({ problem });
  });

  it('never reads a size from the body', () => {
    const read = readUploadDescription({ name: 'big.bin', size: 1 });
    expect(read).not.toHaveProperty('description.size');
  });
});

describe('recordUpload', () => {
  const upload = {
    userId: 'user-1',
    description: { name: 'photo.png', type: 'image/png', folderId: null },
    size: 40_000_000,
    downloadUrl: 'https://res.cloudinary.com/x/photo.png',
    storagePath: 'users/user-1/photo',
    storageType: 'cloudinary' as const,
  };

  beforeEach(() => {
    db.client = null;
  });

  it('writes the size the provider reported', async () => {
    const mock = mockSupabase({ files: { data: [{ id: 'f1', size: 40_000_000 }] } });
    db.client = mock.client;

    await expect(recordUpload(upload)).resolves.toMatchObject({ id: 'f1' });

    const insert = mock.calls.find((call) => call.op === 'insert');
    expect(insert?.args?.[0]).toMatchObject({
      size: 40_000_000,
      storage_type: 'cloudinary',
      storage_path: 'users/user-1/photo',
      user_id: 'user-1',
      folder_id: null,
    });
  });

  it('says the quota refused it when the trigger answers PT413', async () => {
    db.client = mockSupabase({
      files: { error: { message: 'Storage limit exceeded', code: 'PT413' } } as TableAnswer,
    }).client;

    await expect(recordUpload(upload)).rejects.toBeInstanceOf(QuotaExceeded);
  });

  it("says the folder is unknown when it is not the account's", async () => {
    db.client = mockSupabase({
      files: { error: { message: 'violates foreign key', code: '23503' } } as TableAnswer,
    }).client;

    await expect(recordUpload(upload)).rejects.toBeInstanceOf(UnknownFolder);
  });

  it('passes any other failure on', async () => {
    db.client = mockSupabase({
      files: { error: { message: 'connection reset' } } as TableAnswer,
    }).client;

    await expect(recordUpload(upload)).rejects.toThrow(
      'Could not record the upload: connection reset'
    );
  });
});
