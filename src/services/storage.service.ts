import cloudinaryService from './cloudinary.service';
import googleDriveService from './googledrive.service';
import r2Service from './r2.service';
import supabaseService from './supabase.service';
import supabaseStorageService from './supabase-storage.service';
import { FileMetadata, Folder } from '../schemas/file.schema';

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
    return files.reduce((total, file) => total + file.size, 0);
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
    let downloadURL: string = '';
    let storagePath: string = '';
    let storageType: 'cloudinary' | 'googledrive' | 'r2' | 'supabase_storage' = 'cloudinary';

    // 0. Special case for PDFs: Route to Supabase Storage to avoid Cloudinary restrictions
    const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';

    if (isPdf) {
      const result = await supabaseStorageService.uploadFile(file, userId, onProgress);
      downloadURL = result.url;
      storagePath = result.path;
      storageType = 'supabase_storage';
    } else {
      // 1. Determine Storage Provider for non-PDF files
      const canUploadLocal = await this.canUploadToLocal(userId, file.size);
      const shouldUseGoogleDrive = useGoogleDrive || (!canUploadLocal && googleDriveService.isConnected());

      if (shouldUseGoogleDrive && googleDriveService.isConnected()) {
        // Use Google Drive fallback
        const driveFile = await googleDriveService.uploadFile(file, undefined, onProgress);
        downloadURL = driveFile.webViewLink;
        storagePath = driveFile.id;
        storageType = 'googledrive';
      } else if (!canUploadLocal && !googleDriveService.isConnected()) {
        throw new Error('Storage limit exceeded. Connect Google Drive to upload more files.');
      } else if (r2Service.isConfigured()) {
        // Prefer R2 if explicitly configured
        const result = await r2Service.uploadFile(file, userId, (p) => {
          if (onProgress) onProgress({ bytesTransferred: 0, totalBytes: file.size, progress: p });
        });
        downloadURL = result.url;
        storagePath = result.key;
        storageType = 'r2';
      } else if (cloudinaryService.isConfigured()) {
        // Default free provider
        const result = await cloudinaryService.uploadFile(file, userId, onProgress);
        downloadURL = result.url;
        storagePath = result.publicId;
        storageType = 'cloudinary';
      } else {
        throw new Error('No storage provider configured.');
      }
    }

    // 2. Save Metadata to Supabase
    return await supabaseService.saveFileMetadata({
      name: file.name,
      size: file.size,
      type: file.type,
      download_url: downloadURL,
      storage_path: storagePath,
      storage_type: storageType,
      folder_id: folderId,
      user_id: userId,
    });
  },

  /**
   * Get files and folders
   */
  async getItems(userId: string, folderId: string | null = null) {
    const [files, folders] = await Promise.all([
      supabaseService.getFiles(userId, folderId),
      supabaseService.getFolders(userId, folderId),
    ]);
    return { files, folders };
  },

  /**
   * Delete file
   */
  async deleteFile(fileId: string): Promise<void> {
    const file = await this.getFileMetadata(fileId);
    if (!file) throw new Error('File not found');

    // 1. Delete from Provider
    try {
      if (file.storage_type === 'r2') {
        await r2Service.deleteFile(file.storage_path);
      } else if (file.storage_type === 'cloudinary') {
        await cloudinaryService.deleteFile(file.storage_path);
      } else if (file.storage_type === 'googledrive') {
        await googleDriveService.deleteFile(file.storage_path);
      } else if (file.storage_type === 'supabase_storage') {
        await supabaseStorageService.deleteFile(file.storage_path);
      }
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

    // If it's supabase_storage, get a fresh signed URL (they expire)
    if (file && file.storage_type === 'supabase_storage') {
      try {
        file.download_url = await supabaseStorageService.getSignedUrl(file.storage_path);
      } catch (error) {
        console.error('Failed to refresh signed URL for supabase_storage:', error);
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
