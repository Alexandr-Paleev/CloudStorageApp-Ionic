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
    // 1. Select the best provider
    const provider = await providerManager.selectProvider(file, userId, {
      canUploadToLocal: (size) => this.canUploadToLocal(userId, size),
      useGoogleDrive,
    });

    // 2. Perform the upload with Retries
    const result = await withRetry(
      () => provider.upload(file, userId, onProgress),
      {
        maxRetries: 2,
        onRetry: (error, attempt) => {
          console.warn(`Upload attempt ${attempt} failed for ${file.name}. Retrying...`, error);
        }
      }
    );

    // 3. Save Metadata to Supabase with "Transactionality" (Cleanup on failure)
    try {
      return await supabaseService.saveFileMetadata({
        name: file.name,
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

      // Cleanup the uploaded file to avoid orphan "ghost" files
      try {
        await provider.delete(result.path);
      } catch (cleanupError) {
        console.error('Critical: Failed to cleanup orphan file after database failure:', cleanupError);
      }

      throw new Error(`Failed to finalize upload: ${dbError instanceof Error ? dbError.message : 'Unknown database error'}`);
    }
  },

  /**
   * Get files and folders
   */
  async getItems(
    userId: string,
    folderId: string | null = null,
    page?: number,
    pageSize?: number
  ) {
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
   * Delete file
   */
  async deleteFile(fileId: string): Promise<void> {
    const file = await this.getFileMetadata(fileId);
    if (!file) throw new Error('File not found');

    // 1. Get the correct provider and delete
    try {
      const provider = providerManager.getProvider(file.storage_type);
      await provider.delete(file.storage_path);
    } catch (error) {
      console.error(`Failed to delete file from ${file.storage_type}:`, error);
    }

    // 2. Delete Metadata from Supabase
    await supabaseService.deleteFileMetadata(fileId);
  },

  /**
   * Get single file metadata
   */
  async getFileMetadata(fileId: string): Promise<FileMetadata | null> {
    const { supabase } = await import('../supabase/supabase.config');
    const { data } = await supabase
      .from('files')
      .select('*')
      .eq('id', fileId)
      .single();
    const file = data as FileMetadata;

    // If the provider supports signed URLs, refresh it
    if (file) {
      try {
        const provider = providerManager.getProvider(file.storage_type);
        if (provider.getSignedUrl) {
          file.download_url = await provider.getSignedUrl(file.storage_path);
        }
      } catch (error) {
        console.error(`Failed to refresh URL for ${file.storage_type}:`, error);
      }
    }

    return file;
  },

  /**
   * Rename file
   */
  async renameFile(fileId: string, name: string): Promise<void> {
    await supabaseService.updateFileMetadata(fileId, { name });
  },

  /**
   * Folders
   */
  async createFolder(userId: string, name: string, parentId: string | null = null): Promise<Folder> {
    return await supabaseService.createFolder({
      name,
      user_id: userId,
      parent_id: parentId,
    });
  },

  async deleteFolder(folderId: string): Promise<void> {
    await supabaseService.deleteFolder(folderId);
  },
};

export default storageService;
