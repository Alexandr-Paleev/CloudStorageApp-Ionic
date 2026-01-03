import { IStorageProvider, StorageUploadResult } from '../storage.provider';
import r2Service from '../../services/r2.service';
import { UploadProgress } from '../../services/storage.service';

export class R2Provider implements IStorageProvider {
    readonly name = 'r2';

    isConfigured(): boolean {
        return r2Service.isConfigured();
    }

    async upload(
        file: File,
        userId: string,
        onProgress?: (progress: UploadProgress) => void
    ): Promise<StorageUploadResult> {
        const result = await r2Service.uploadFile(file, userId, (p) => {
            if (onProgress) onProgress({ bytesTransferred: 0, totalBytes: file.size, progress: p });
        });
        return {
            url: result.url,
            path: result.key,
            type: 'r2',
        };
    }

    async delete(path: string, _metadata?: { type?: string; name?: string }): Promise<void> {
        await r2Service.deleteFile(path);
    }

    async getSignedUrl(path: string): Promise<string> {
        return await r2Service.getSignedDownloadUrl(path);
    }
}
