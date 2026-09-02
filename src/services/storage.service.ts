import supabaseService from './supabase.service';
import { FileMetadata, Folder } from '../schemas/file.schema';
import { providerManager } from '../providers/ProviderManager';
import { withRetry } from '../utils/retry.utils';
import { isRetriableError } from '../utils/http.utils';
import * as Sentry from '../observability/sentry';
import { DEFAULT_STORAGE_LIMIT } from '../../lib/tiers';
import { isQuotaRejection } from '../utils/quota.utils';
import r2Service from './r2.service';
import type { PendingUpload } from './upload-store';
import { isSearching, type FileQuery } from '../utils/file-query';

export type { FileMetadata, Folder };
export type { PendingUpload };
export type { FileQuery };

export type UploadProgress = {
  bytesTransferred: number;
  totalBytes: number;
  progress: number;
};

const storageService = {
  /**
   * Get total storage size used by user
   */
  async getUserStorageSize(userId: string): Promise<number> {
    return supabaseService.getTotalStorageUsed(userId);
  },

  /**
   * Check if user can upload file to local storage (Cloudinary/R2)
   */
  async canUploadToLocal(
    userId: string,
    fileSize: number,
    storageLimit?: number
  ): Promise<boolean> {
    const currentSize = await this.getUserStorageSize(userId);
    const limit = storageLimit ?? DEFAULT_STORAGE_LIMIT;
    return currentSize + fileSize <= limit;
  },

  /**
   * Upload file and save metadata
   */
  async uploadFile(
    userId: string,
    file: File,
    onProgress?: (progress: UploadProgress) => void,
    folderId: string | null = null,
    useGoogleDrive?: boolean,
    options?: {
      preferredProvider?: string;
      allowedProviders?: string[];
      storageLimit?: number;
      /** Aborting this pauses a resumable upload rather than failing it: the
       *  parts already in the bucket stay, and so does the record that knows
       *  which ones they were. */
      signal?: AbortSignal;
    }
  ): Promise<FileMetadata> {
    const provider = await providerManager.selectProvider(file, userId, {
      canUploadToLocal: (size) => this.canUploadToLocal(userId, size, options?.storageLimit),
      useGoogleDrive,
      preferredProvider: options?.preferredProvider,
      allowedProviders: options?.allowedProviders,
    });

    const result = await withRetry(
      () => provider.upload(file, userId, onProgress, { signal: options?.signal, folderId }),
      {
        maxRetries: 2,
        // A rejected upload (quota, auth) fails the same way every time — surface
        // it immediately instead of making the user wait through the backoff
        shouldRetry: isRetriableError,
        onRetry: (error, attempt) => {
          console.warn(`Upload attempt ${attempt} failed for ${file.name}. Retrying...`, error);
        },
      }
    );

    return this.finalizeUpload(userId, file, result, provider, folderId);
  },

  /**
   * Writes the row that makes an uploaded object a file in this app.
   *
   * Shared by a fresh upload and a resumed one, because the interesting part is
   * what happens when it fails: the object is already in the bucket, and a row
   * that never lands would leave it there uncounted and invisible. The delete
   * below is a compensating transaction — the bucket and the database cannot
   * share one.
   */
  async finalizeUpload(
    userId: string,
    file: { name: string; type: string; size: number },
    result: { url: string; path: string; type: string; bytes?: number },
    provider: { delete: (path: string) => Promise<void> },
    folderId: string | null
  ): Promise<FileMetadata> {
    try {
      const { validateAndSanitizeName } = await import('../schemas/file.schema');
      const sanitizedName = validateAndSanitizeName(file.name);

      return await supabaseService.saveFileMetadata({
        name: sanitizedName,
        // What the provider says it stored, when it says: the row should
        // describe the asset that exists, not the one that was picked.
        size: result.bytes ?? file.size,
        type: file.type,
        download_url: result.url,
        storage_path: result.path,
        storage_type: result.type as FileMetadata['storage_type'],
        folder_id: folderId,
        user_id: userId,
      });
    } catch (dbError) {
      const overQuota = isQuotaRejection(dbError);

      if (!overQuota) {
        Sentry.captureException(dbError, {
          tags: { context: 'storage.uploadFile' },
          extra: { fileName: file.name, userId },
        });
      }

      try {
        await provider.delete(result.path);
      } catch (cleanupError) {
        Sentry.captureException(cleanupError, {
          level: 'fatal',
          tags: { context: 'storage.uploadFile.cleanup' },
          extra: { path: result.path, userId },
        });
      }

      if (overQuota) {
        // Drive and Dropbox really are a way out of this: the trigger does not
        // count what lives in the user's own cloud (see migrations/007), so an
        // upload routed there succeeds while the plan is full.
        throw new Error(
          'Storage limit exceeded. The file was not kept — free up space, ' +
            'upgrade to Pro, or upload to Google Drive / Dropbox instead.'
        );
      }

      throw new Error(
        `Failed to finalize upload: ${dbError instanceof Error ? dbError.message : 'Unknown database error'}`
      );
    }
  },

  /**
   * Uploads that were interrupted and can still be finished.
   *
   * Only R2 has them: it is the only provider here that uploads in parts, and
   * therefore the only one where "half an upload" is a thing that exists.
   */
  async resumableUploads(): Promise<PendingUpload[]> {
    return r2Service.resumableUploads();
  },

  /**
   * Finishes an interrupted upload and records the file.
   *
   * Takes the same path to the row as a fresh upload, including the
   * compensating delete — from the database's point of view nothing about this
   * file is unusual, and the quota trigger weighs it exactly the same.
   */
  async resumeUpload(
    userId: string,
    record: PendingUpload,
    onProgress?: (progress: UploadProgress) => void,
    signal?: AbortSignal
  ): Promise<FileMetadata> {
    const result = await r2Service.resumeUpload(
      record,
      (percent) => {
        if (onProgress) {
          onProgress({
            bytesTransferred: Math.round((percent / 100) * record.size),
            totalBytes: record.size,
            progress: percent,
          });
        }
      },
      signal
    );

    const provider = providerManager.getProvider('r2');

    return this.finalizeUpload(
      userId,
      { name: record.fileName, type: record.contentType, size: record.size },
      { url: result.url, path: result.key, type: 'r2', bytes: record.size },
      provider,
      record.folderId
    );
  },

  /** Abandons an interrupted upload and releases the parts R2 is holding. */
  async discardUpload(record: PendingUpload): Promise<void> {
    await r2Service.discardUpload(record);
  },

  /**
   * Get files and folders
   */
  async getItems(userId: string, options: FileQuery = {}) {
    const { folderId = null, page } = options;

    /* Folders are not searched, filtered or sorted with the files: they carry
       none of the same fields, and a search that returned three folders and no
       files would read as "nothing found". While a search is running the
       listing is files only, and the dashboard says so. */
    const wantsFolders = (page === 0 || page === undefined) && !isSearching(options);

    const [files, folders] = await Promise.all([
      supabaseService.getFiles(userId, options),
      wantsFolders ? supabaseService.getFolders(userId, folderId) : Promise.resolve([] as Folder[]),
    ]);
    return { files, folders };
  },

  async getFolder(folderId: string, userId: string): Promise<Folder | null> {
    return supabaseService.getFolder(folderId, userId);
  },

  /**
   * Delete file with user ownership verification
   */
  async deleteFile(fileId: string, userId: string): Promise<void> {
    const file = await this.getFileMetadata(fileId, userId);
    if (!file) {
      throw new Error('File not found or access denied');
    }

    let storageDeleteError: Error | null = null;
    try {
      const provider = providerManager.getProvider(file.storage_type);
      // Pass metadata so the provider knows if it's a PDF (raw) or Image
      await provider.delete(file.storage_path, { type: file.type, name: file.name });
    } catch (error) {
      storageDeleteError =
        error instanceof Error ? error : new Error('Unknown storage deletion error');
      Sentry.captureException(storageDeleteError, {
        tags: { context: 'storage.deleteFile', storageType: file.storage_type },
        extra: { fileId, userId },
      });
      throw new Error(`Failed to delete file from storage: ${storageDeleteError.message}`);
    }

    try {
      await supabaseService.deleteFileMetadata(fileId, userId);
    } catch (dbError) {
      Sentry.captureException(dbError, {
        level: 'fatal',
        tags: { context: 'storage.deleteFile.metadata' },
        extra: { fileId, userId },
      });
      throw new Error(
        `Failed to delete file metadata: ${dbError instanceof Error ? dbError.message : 'Unknown error'}`
      );
    }
  },

  /**
   * Get single file metadata with user ownership verification
   */
  async getFileMetadata(fileId: string, userId: string): Promise<FileMetadata | null> {
    const file = await supabaseService.getFileMetadata(fileId, userId);

    if (!file) {
      return null;
    }

    try {
      const provider = providerManager.getProvider(file.storage_type);
      if (provider.getSignedUrl) {
        file.download_url = await provider.getSignedUrl(file.storage_path);
      }
    } catch (error) {
      Sentry.captureException(error, {
        tags: { context: 'storage.getFileMetadata.refreshUrl', storageType: file.storage_type },
        extra: { fileId, userId },
      });
    }

    return file;
  },

  /**
   * Rename file with validation and user ownership verification
   */
  async renameFile(fileId: string, userId: string, name: string): Promise<void> {
    const { validateAndSanitizeName } = await import('../schemas/file.schema');
    const sanitizedName = validateAndSanitizeName(name);

    await supabaseService.updateFileMetadata(fileId, userId, { name: sanitizedName });
  },

  /**
   * Folders
   */
  async createFolder(
    userId: string,
    name: string,
    parentId: string | null = null
  ): Promise<Folder> {
    const { validateAndSanitizeName } = await import('../schemas/file.schema');
    const sanitizedName = validateAndSanitizeName(name);

    return await supabaseService.createFolder({
      name: sanitizedName,
      user_id: userId,
      parent_id: parentId,
    });
  },

  async deleteFolder(folderId: string, userId: string): Promise<void> {
    await supabaseService.deleteFolder(folderId, userId);
  },
};

export default storageService;
