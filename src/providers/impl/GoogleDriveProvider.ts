import { IStorageProvider, StorageUploadResult } from '../storage.provider';
import googleDriveService from '../../services/googledrive.service';
import { UploadProgress } from '../../services/storage.service';

export class GoogleDriveProvider implements IStorageProvider {
    readonly name = 'googledrive';

    isConfigured(): boolean {
        return true; // Configured via env variables
    }

    async isConnected(): Promise<boolean> {
        return await googleDriveService.isConnected();
    }

    async upload(
        file: File,
        _userId: string,
        onProgress?: (progress: UploadProgress) => void
    ): Promise<StorageUploadResult> {
        const result = await googleDriveService.uploadFile(file, undefined, onProgress);
        return {
            url: result.webViewLink,
            path: result.id,
            type: 'googledrive',
        };
    }

    async delete(path: string): Promise<void> {
        await googleDriveService.deleteFile(path);
    }
}
