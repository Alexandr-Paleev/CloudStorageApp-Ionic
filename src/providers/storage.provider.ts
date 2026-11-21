import type { FileMetadata, UploadProgress } from '../services/storage.service';

/** What the browser says about a file it uploaded: never how large it is. */
export interface UploadDescription {
  name: string;
  type: string;
  folderId: string | null;
}

export interface StorageUploadResult {
  url: string;
  path: string;
  type: 'cloudinary' | 'googledrive' | 'r2' | 'supabase_storage' | 'dropbox';
  /**
   * Bytes the provider says it stored, where it says so at all.
   *
   * Preferred over File.size for the row: it is the size of the thing that
   * actually exists, and Cloudinary in particular can hand back a different
   * number than what was sent. It is still a figure this browser reports, so
   * a row it writes counts it only where the database can check it (Supabase
   * Storage, migration 020); Cloudinary and R2 rows are weighed by `record`.
   */
  bytes?: number;
  /** Cloudinary only: the endpoint the asset went to, which the server chose
   *  when it signed the upload and asks again when it records it. */
  resourceType?: 'image' | 'raw';
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
   * Whether an upload of this file can be paused and continued later, which
   * is when the upload page offers Pause. A provider that cannot leaves this
   * out: an upload it stopped would be lost, not paused.
   */
  resumes?(file: File): boolean;

  /**
   * Upload a file
   */
  upload(
    file: File,
    userId: string,
    onProgress?: (progress: UploadProgress) => void,
    /** Only R2 acts on these today: it is the one provider whose uploads are
     *  long enough to be worth pausing and resuming. The rest ignore them. */
    options?: { signal?: AbortSignal; folderId?: string | null }
  ): Promise<StorageUploadResult>;

  /**
   * Records an upload through the server, which asks the provider how many
   * bytes it holds and writes the row itself (migration 020,
   * docs/decisions/0017-the-server-weighs-an-upload.md). A provider without
   * this has its row written by the browser.
   */
  record?(result: StorageUploadResult, description: UploadDescription): Promise<FileMetadata>;

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
