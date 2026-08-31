import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import storageService from './storage.service';
import { providerManager } from '../providers/ProviderManager';
import supabaseService from './supabase.service';
import * as Sentry from '../observability/sentry';
import { HttpError } from '../utils/http.utils';
import { DEFAULT_STORAGE_LIMIT } from '../../lib/tiers';

vi.mock('../providers/ProviderManager', () => ({
  providerManager: {
    selectProvider: vi.fn(),
    getProvider: vi.fn(),
  },
}));

vi.mock('./supabase.service', () => ({
  default: {
    saveFileMetadata: vi.fn(),
    getTotalStorageUsed: vi.fn(),
    getFileMetadata: vi.fn(),
    deleteFileMetadata: vi.fn(),
  },
}));

vi.mock('../observability/sentry', () => ({
  captureException: vi.fn(),
}));

const uploaded = { url: 'https://cdn.example/abc', path: 'user-1/abc', type: 'r2' as const };
const savedRow = { id: 'file-1', name: 'report.pdf' };

function provider(overrides: Record<string, unknown> = {}) {
  return {
    name: 'r2',
    isConfigured: () => true,
    upload: vi.fn(async () => uploaded),
    delete: vi.fn(async () => undefined),
    ...overrides,
  };
}

/* `size` is read-only on a Blob, so the bytes have to actually be there. */
function file(name = 'report.pdf', type = 'application/pdf', size = 1_024) {
  return new File([new Uint8Array(size)], name, { type });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(supabaseService.saveFileMetadata).mockResolvedValue(
    savedRow as unknown as Awaited<ReturnType<typeof supabaseService.saveFileMetadata>>
  );
  // The retry path logs a warning before backing off; the test output is more
  // useful without it.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

describe('uploadFile', () => {
  it('writes the metadata the provider handed back', async () => {
    vi.mocked(providerManager.selectProvider).mockResolvedValue(provider());

    const result = await storageService.uploadFile('user-1', file(), undefined, 'folder-9');

    expect(result).toBe(savedRow);
    expect(supabaseService.saveFileMetadata).toHaveBeenCalledWith({
      name: 'report.pdf',
      size: 1_024,
      type: 'application/pdf',
      download_url: uploaded.url,
      storage_path: uploaded.path,
      storage_type: 'r2',
      folder_id: 'folder-9',
      user_id: 'user-1',
    });
  });

  it('strips path separators out of the name before storing it', async () => {
    // The stored name is a label, not a path — the provider decides where the
    // bytes go — but a name carrying separators still has no business in a row
    // that ends up rendered, downloaded and put in a Content-Disposition.
    vi.mocked(providerManager.selectProvider).mockResolvedValue(provider());

    await storageService.uploadFile('user-1', file('../../etc/passwd'));

    const [metadata] = vi.mocked(supabaseService.saveFileMetadata).mock.calls[0];
    expect(metadata.name).toBe('.._.._etc_passwd');
  });

  it('cleans up after a name the schema refuses', async () => {
    // The name is validated after the bytes are already uploaded, so a
    // rejection has to take the same rollback path as a failed insert.
    const r2 = provider();
    vi.mocked(providerManager.selectProvider).mockResolvedValue(r2);

    await expect(storageService.uploadFile('user-1', file('NUL.txt'))).rejects.toThrow(
      'Failed to finalize upload: Invalid file or folder name'
    );

    expect(supabaseService.saveFileMetadata).not.toHaveBeenCalled();
    expect(r2.delete).toHaveBeenCalledWith(uploaded.path);
  });

  it('deletes the uploaded object when the metadata write fails', async () => {
    // The compensating half of a transaction the database cannot give us: the
    // bytes are already in the bucket by the time the row fails, and without
    // this they would sit there forever, counted by nobody.
    const r2 = provider();
    vi.mocked(providerManager.selectProvider).mockResolvedValue(r2);
    vi.mocked(supabaseService.saveFileMetadata).mockRejectedValue(new Error('duplicate key'));

    await expect(storageService.uploadFile('user-1', file())).rejects.toThrow(
      'Failed to finalize upload: duplicate key'
    );

    expect(r2.delete).toHaveBeenCalledWith(uploaded.path);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { context: 'storage.uploadFile' } })
    );
  });

  it('reports an orphaned object as fatal but still surfaces the original failure', async () => {
    const r2 = provider({ delete: vi.fn(async () => Promise.reject(new Error('R2 unreachable'))) });
    vi.mocked(providerManager.selectProvider).mockResolvedValue(r2);
    vi.mocked(supabaseService.saveFileMetadata).mockRejectedValue(new Error('duplicate key'));

    await expect(storageService.uploadFile('user-1', file())).rejects.toThrow(
      'Failed to finalize upload: duplicate key'
    );

    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        level: 'fatal',
        tags: { context: 'storage.uploadFile.cleanup' },
      })
    );
  });

  it('reports a quota rejection from the database as a quota problem', async () => {
    // The trigger from migrations/007 refuses the insert with PT413 — which
    // PostgREST answers as HTTP 413 — and that is an expected answer rather
    // than a fault: the user needs a sentence they can act on, and Sentry does
    // not need the noise.
    const r2 = provider();
    vi.mocked(providerManager.selectProvider).mockResolvedValue(r2);
    vi.mocked(supabaseService.saveFileMetadata).mockRejectedValue(
      Object.assign(new Error('Storage limit exceeded: 524288000 of 524288000 bytes used'), {
        code: 'PT413',
      })
    );

    await expect(storageService.uploadFile('user-1', file())).rejects.toThrow(
      /Storage limit exceeded\. The file was not kept/
    );

    // Still rolled back: the bytes reached the bucket before the row was tried.
    expect(r2.delete).toHaveBeenCalledWith(uploaded.path);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('retries an upload the server may yet accept', async () => {
    vi.useFakeTimers();
    const r2 = provider({
      upload: vi
        .fn()
        .mockRejectedValueOnce(new HttpError('Bad gateway', 502))
        .mockResolvedValue(uploaded),
    });
    vi.mocked(providerManager.selectProvider).mockResolvedValue(r2);

    const pending = storageService.uploadFile('user-1', file());
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toBe(savedRow);
    expect(r2.upload).toHaveBeenCalledTimes(2);
  });

  it('does not retry a rejection that will repeat — the user waits for nothing', async () => {
    const r2 = provider({
      upload: vi.fn().mockRejectedValue(new HttpError('Storage limit exceeded', 413)),
    });
    vi.mocked(providerManager.selectProvider).mockResolvedValue(r2);

    await expect(storageService.uploadFile('user-1', file())).rejects.toThrow(
      'Storage limit exceeded'
    );
    expect(r2.upload).toHaveBeenCalledTimes(1);
    expect(supabaseService.saveFileMetadata).not.toHaveBeenCalled();
  });
});

describe('canUploadToLocal', () => {
  it("uses the plan's limit when the caller knows it", async () => {
    vi.mocked(supabaseService.getTotalStorageUsed).mockResolvedValue(600 * 1024 * 1024);

    expect(await storageService.canUploadToLocal('user-1', 1, 5 * 1024 * 1024 * 1024)).toBe(true);
    expect(await storageService.canUploadToLocal('user-1', 1)).toBe(false);
  });

  it('allows a file that exactly fills the plan, and nothing past it', async () => {
    vi.mocked(supabaseService.getTotalStorageUsed).mockResolvedValue(DEFAULT_STORAGE_LIMIT - 100);

    expect(await storageService.canUploadToLocal('user-1', 100)).toBe(true);
    expect(await storageService.canUploadToLocal('user-1', 101)).toBe(false);
  });
});

describe('deleteFile', () => {
  it("refuses a file that is not the caller's", async () => {
    vi.mocked(supabaseService.getFileMetadata).mockResolvedValue(null);

    await expect(storageService.deleteFile('file-1', 'user-2')).rejects.toThrow(
      'File not found or access denied'
    );
    expect(supabaseService.deleteFileMetadata).not.toHaveBeenCalled();
  });

  it('keeps the row when the object could not be deleted', async () => {
    // Losing the row first would leave a file nobody can see and nobody can
    // remove, still counted against the quota.
    vi.mocked(supabaseService.getFileMetadata).mockResolvedValue({
      id: 'file-1',
      name: 'report.pdf',
      type: 'application/pdf',
      storage_type: 'r2',
      storage_path: 'user-1/abc',
    } as unknown as Awaited<ReturnType<typeof supabaseService.getFileMetadata>>);
    vi.mocked(providerManager.getProvider).mockReturnValue(
      provider({ delete: vi.fn(async () => Promise.reject(new Error('R2 unreachable'))) })
    );

    await expect(storageService.deleteFile('file-1', 'user-1')).rejects.toThrow(
      'Failed to delete file from storage: R2 unreachable'
    );
    expect(supabaseService.deleteFileMetadata).not.toHaveBeenCalled();
  });
});

describe('getFileMetadata', () => {
  const row = {
    id: 'file-1',
    name: 'report.pdf',
    type: 'application/pdf',
    storage_type: 'r2',
    storage_path: 'user-1/abc',
    download_url: 'https://cdn.example/stale',
  };

  it('refreshes a URL that expires', async () => {
    vi.mocked(supabaseService.getFileMetadata).mockResolvedValue({
      ...row,
    } as unknown as Awaited<ReturnType<typeof supabaseService.getFileMetadata>>);
    vi.mocked(providerManager.getProvider).mockReturnValue(
      provider({ getSignedUrl: vi.fn(async () => 'https://cdn.example/fresh') })
    );

    const file = await storageService.getFileMetadata('file-1', 'user-1');

    expect(file?.download_url).toBe('https://cdn.example/fresh');
  });

  it('still returns the file when signing fails', async () => {
    vi.mocked(supabaseService.getFileMetadata).mockResolvedValue({
      ...row,
    } as unknown as Awaited<ReturnType<typeof supabaseService.getFileMetadata>>);
    vi.mocked(providerManager.getProvider).mockReturnValue(
      provider({ getSignedUrl: vi.fn(async () => Promise.reject(new Error('signing failed'))) })
    );

    const file = await storageService.getFileMetadata('file-1', 'user-1');

    expect(file?.download_url).toBe('https://cdn.example/stale');
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});
