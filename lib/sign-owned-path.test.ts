import { describe, it, expect, vi, beforeEach } from 'vitest';

const { storage, signedUrl } = vi.hoisted(() => ({
  storage: { createSignedUrl: vi.fn() },
  signedUrl: vi.fn(),
}));

vi.mock('./auth', () => ({ supabase: { storage: { from: () => storage } } }));

vi.mock('./r2', () => ({
  getS3Client: () => ({}),
  getR2BucketName: () => 'bucket',
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => signedUrl(...args),
}));

import { NotOwnedError, signOwnedPath } from './sign-owned-path';

const OWNER = 'user-1';

beforeEach(() => {
  vi.clearAllMocks();
  signedUrl.mockResolvedValue('https://r2.example/signed');
  storage.createSignedUrl.mockResolvedValue({
    data: { signedUrl: 'https://supa.example/signed' },
    error: null,
  });
});

describe('signOwnedPath', () => {
  it("signs an R2 key under the owner's prefix, for as long as it was asked", async () => {
    const url = await signOwnedPath(
      { storage_type: 'r2', storage_path: 'users/user-1/report.pdf' },
      OWNER,
      300
    );

    expect(url).toBe('https://r2.example/signed');
    const [, command, options] = signedUrl.mock.calls[0] as [
      unknown,
      { input: Record<string, unknown> },
      unknown,
    ];
    expect(command.input).toMatchObject({ Bucket: 'bucket', Key: 'users/user-1/report.pdf' });
    expect(options).toEqual({ expiresIn: 300 });
  });

  it("signs a Supabase Storage path under the owner's prefix", async () => {
    const url = await signOwnedPath(
      { storage_type: 'supabase_storage', storage_path: 'user-1/report.pdf' },
      OWNER,
      3600
    );

    expect(url).toBe('https://supa.example/signed');
    expect(storage.createSignedUrl).toHaveBeenCalledWith('user-1/report.pdf', 3600);
  });

  it.each([
    ['r2', 'users/user-2/theirs.pdf'],
    ['supabase_storage', 'user-2/theirs.pdf'],
  ])(
    "refuses a %s path outside the owner's storage before signing anything",
    async (storage_type, storage_path) => {
      // The row is the browser's writing, and both credentials below sign
      // whatever path they are handed.
      await expect(
        signOwnedPath({ storage_type, storage_path }, OWNER, 300)
      ).rejects.toBeInstanceOf(NotOwnedError);
      expect(signedUrl).not.toHaveBeenCalled();
      expect(storage.createSignedUrl).not.toHaveBeenCalled();
    }
  );

  it.each(['cloudinary', 'googledrive', 'dropbox'])(
    'returns null for %s, which stores a delivery URL rather than a private object',
    async (storage_type) => {
      expect(
        await signOwnedPath({ storage_type, storage_path: 'anything' }, OWNER, 300)
      ).toBeNull();
      expect(signedUrl).not.toHaveBeenCalled();
      expect(storage.createSignedUrl).not.toHaveBeenCalled();
    }
  );

  it('fails loudly when Supabase hands back no URL', async () => {
    storage.createSignedUrl.mockResolvedValue({
      data: null,
      error: { message: 'Object not found' },
    });

    await expect(
      signOwnedPath(
        { storage_type: 'supabase_storage', storage_path: 'user-1/gone.pdf' },
        OWNER,
        300
      )
    ).rejects.toThrow(/Object not found/);
  });
});
