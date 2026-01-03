import { UploadProgress } from '../services/storage.service';

export interface StorageUploadResult {
    url: string;
    path: string;
    type: 'cloudinary' | 'googledrive' | 'r2' | 'supabase_storage';
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
     */
    delete(path: string, metadata?: { type?: string; name?: string }): Promise<void>;

    /**
     * Get a fresh signed URL (optional)
     */
    getSignedUrl?(path: string): Promise<string>;
}
