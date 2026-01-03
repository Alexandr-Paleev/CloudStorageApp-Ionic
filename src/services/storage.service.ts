import supabaseService from './supabase.service';
import { FileMetadata, Folder } from '../schemas/file.schema';
import { providerManager } from '../providers/ProviderManager';
import { withRetry } from '../utils/retry.utils';

export const MAX_USER_STORAGE_LIMIT = 500 * 1024 * 1024; // 500 MB in bytes (Local limit before GDrive)

export type { FileMetadata, Folder };

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
    const files = await supabaseService.getFiles(userId);
    return files.reduce((total: number, file: FileMetadata) => total + file.size, 0);
  },

  /**
   * Check if user can upload file to local storage (Cloudinary/R2)
   */
  async canUploadToLocal(userId: string, fileSize: number): Promise<boolean> {
    const currentSize = await this.getUserStorageSize(userId);
    return currentSize + fileSize <= MAX_USER_STORAGE_LIMIT;
  },

  /**
   * Upload file and save metadata
   */
  async uploadFile(
    userId: string,
    file: File,
    onProgress?: (progress: UploadProgress) => void,
    folderId: string | null = null,
    useGoogleDrive?: boolean
  ): Promise<FileMetadata> {
    const provider = await providerManager.selectProvider(file, userId, {
      canUploadToLocal: (size) => this.canUploadToLocal(userId, size),
      useGoogleDrive,
    });

    const result = await withRetry(() => provider.upload(file, userId, onProgress), {
      maxRetries: 2,
      onRetry: (error, attempt) => {
        console.warn(`Upload attempt ${attempt} failed for ${file.name}. Retrying...`, error);
      },
    });

    try {
      const { validateAndSanitizeName } = await import('../schemas/file.schema');
      const sanitizedName = validateAndSanitizeName(file.name);

      return await supabaseService.saveFileMetadata({
        name: sanitizedName,
        size: file.size,
        type: file.type,
        download_url: result.url,
        storage_path: result.path,
        storage_type: result.type,
        folder_id: folderId,
        user_id: userId,
      });
    } catch (dbError) {
      console.error('Failed to save file metadata to Supabase. Rolling back storage...', dbError);

      try {
        await provider.delete(result.path);
      } catch (cleanupError) {
        console.error(
          'Critical: Failed to cleanup orphan file after database failure:',
          cleanupError
        );
      }

      throw new Error(
        `Failed to finalize upload: ${dbError instanceof Error ? dbError.message : 'Unknown database error'}`
      );
    }
  },

  /**
   * Get files and folders
   */
  async getItems(userId: string, folderId: string | null = null, page?: number, pageSize?: number) {
    const [files, folders] = await Promise.all([
      supabaseService.getFiles(userId, folderId, page, pageSize),
      // Only fetch folders on the first page to avoid duplication in infinite scroll
      page === 0 || page === undefined
        ? supabaseService.getFolders(userId, folderId)
        : Promise.resolve([] as Folder[]),
    ]);
    return { files, folders };
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
      console.error(`Failed to delete file from ${file.storage_type}:`, storageDeleteError);
      throw new Error(`Failed to delete file from storage: ${storageDeleteError.message}`);
    }

    try {
      await supabaseService.deleteFileMetadata(fileId, userId);
    } catch (dbError) {
      console.error('Critical: Storage file deleted but metadata deletion failed:', dbError);
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
      console.error(`Failed to refresh URL for ${file.storage_type}:`, error);
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
