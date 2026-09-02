import { UploadProgress } from '../services/storage.service';

export interface StorageUploadResult {
  url: string;
  path: string;
  type: 'cloudinary' | 'googledrive' | 'r2' | 'supabase_storage' | 'dropbox';
  /**
   * Bytes the provider says it stored, where it says so at all.
   *
   * Preferred over File.size for the row: it is the size of the thing that
   * actually exists, and Cloudinary in particular can hand back a different
   * number than what was sent. It is still a figure this browser reports —
   * see the quota note in README.md for what that does and does not buy.
   */
  bytes?: number;
}

export interface IStorageProvider {
  /**
   * Unique identifier for the provider
   */
  readonly name: string;

  /**
   * Check if the provider is correctly configured (API keys, etc.)
   */
  isConfigured(): boolean;

  /**
   * Check if the provider is currently connected/authorized
   */
  isConnected?(): Promise<boolean> | boolean;

  /**
   * Upload a file
   */
  upload(
    file: File,
    userId: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<StorageUploadResult>;

  /**
   * Delete a file
   * @param path Storage path/key
   * @param metadata Optional file metadata (mime type, name) to help provider decide how to delete
   */
  delete(path: string, metadata?: { type?: string; name?: string }): Promise<void>;

  /**
   * Get a fresh signed URL (optional)
   */
  getSignedUrl?(path: string): Promise<string>;
}
