import { describe, expect, it, vi } from 'vitest';

/* What each service answers an upload with, enough for its provider to map. */
const uploadFile = vi.hoisted(() => ({
  cloudinary: vi.fn(async () => ({
    publicId: 'users/user-1/a',
    url: 'https://res.cloudinary.com/a',
    format: 'png',
    bytes: 1,
  })),
  googledrive: vi.fn(async () => ({
    id: 'f1',
    name: 'a.txt',
    webViewLink: 'https://drive.google.com/file/d/f1',
  })),
  dropbox: vi.fn(async () => ({ id: 'id:1', sharedLink: 'https://www.dropbox.com/s/1/a.txt' })),
  supabase: vi.fn(async () => ({ path: 'user-1/1_a.txt', url: 'https://project.supabase.co/a' })),
}));

vi.mock('../../services/cloudinary.service', () => ({
  default: { uploadFile: uploadFile.cloudinary, isConfigured: () => true },
}));
vi.mock('../../services/googledrive.service', () => ({
  default: { uploadFile: uploadFile.googledrive, isConnected: async () => true },
}));
vi.mock('../../services/dropbox.service', () => ({
  default: { uploadFile: uploadFile.dropbox, isConnected: async () => true },
}));
vi.mock('../../services/supabase-storage.service', () => ({
  default: { uploadFile: uploadFile.supabase },
}));

import { CloudinaryProvider } from './CloudinaryProvider';
import { DropboxProvider } from './DropboxProvider';
import { GoogleDriveProvider } from './GoogleDriveProvider';
import { SupabaseStorageProvider } from './SupabaseStorageProvider';

/* The page's Cancel aborts the signal it hands storageService, which hands it
   to the provider. Only R2's provider passed it on, so on production, where
   R2 is off, a Cancel would have stopped nothing. */
describe("an upload's signal", () => {
  it.each([
    ['Cloudinary', () => new CloudinaryProvider(), uploadFile.cloudinary],
    ['Google Drive', () => new GoogleDriveProvider(), uploadFile.googledrive],
    ['Dropbox', () => new DropboxProvider(), uploadFile.dropbox],
    ['Supabase Storage', () => new SupabaseStorageProvider(), uploadFile.supabase],
  ] as const)('reaches the %s service', async (_name, provider, sent) => {
    const { signal } = new AbortController();

    await provider().upload(new File(['x'], 'a.txt'), 'user-1', undefined, { signal });

    expect(sent.mock.calls[0]!.at(-1)).toBe(signal);
  });
});
