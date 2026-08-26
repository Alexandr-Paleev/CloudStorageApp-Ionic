import { IStorageProvider, StorageUploadResult } from '../storage.provider';
import dropboxService from '../../services/dropbox.service';
import { UploadProgress } from '../../services/storage.service';

export class DropboxProvider implements IStorageProvider {
  readonly name = 'dropbox';

  isConfigured(): boolean {
    return !!import.meta.env.VITE_DROPBOX_APP_KEY;
  }

  async isConnected(): Promise<boolean> {
    return dropboxService.isConnected();
  }

  async upload(
    file: File,
    userId: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<StorageUploadResult> {
    const result = await dropboxService.uploadFile(file, userId, onProgress);
    return {
      url: result.sharedLink,
      path: result.id,
      type: 'dropbox',
    };
  }

  async delete(path: string): Promise<void> {
    await dropboxService.deleteFile(path);
  }
}
