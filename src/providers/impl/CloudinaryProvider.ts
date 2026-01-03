import { IStorageProvider, StorageUploadResult } from '../storage.provider';
import cloudinaryService from '../../services/cloudinary.service';
import { UploadProgress } from '../../services/storage.service';

export class CloudinaryProvider implements IStorageProvider {
    readonly name = 'cloudinary';

    isConfigured(): boolean {
        return cloudinaryService.isConfigured();
    }

    async upload(
        file: File,
        userId: string,
        onProgress?: (progress: UploadProgress) => void
    ): Promise<StorageUploadResult> {
        const result = await cloudinaryService.uploadFile(file, userId, onProgress);
        return {
            url: result.url,
            path: result.publicId,
            type: 'cloudinary',
        };
    }

    async delete(path: string): Promise<void> {
        await cloudinaryService.deleteFile(path);
    }
}
