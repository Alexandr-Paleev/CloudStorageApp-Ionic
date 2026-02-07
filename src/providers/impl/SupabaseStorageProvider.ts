import { IStorageProvider, StorageUploadResult } from '../storage.provider';
import supabaseStorageService from '../../services/supabase-storage.service';
import { UploadProgress } from '../../services/storage.service';

export class SupabaseStorageProvider implements IStorageProvider {
  readonly name = 'supabase_storage';

  isConfigured(): boolean {
    return true; // Configured via supabase.config.ts
  }

  async upload(
    file: File,
    userId: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<StorageUploadResult> {
    const result = await supabaseStorageService.uploadFile(file, userId, onProgress);
    return {
      url: result.url,
      path: result.path,
      type: 'supabase_storage',
    };
  }

  async delete(path: string, _metadata?: { type?: string; name?: string }): Promise<void> {
    await supabaseStorageService.deleteFile(path);
  }

  async getSignedUrl(path: string): Promise<string> {
    return await supabaseStorageService.getSignedUrl(path);
  }
}
