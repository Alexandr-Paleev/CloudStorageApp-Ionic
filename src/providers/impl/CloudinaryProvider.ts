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

  async delete(path: string, metadata?: { type?: string; name?: string }): Promise<void> {
    let resourceType: string | undefined;
    let finalPath = path;

    // Check if it's a PDF, which is stored as 'raw' in Cloudinary
    // Logic updated to handle both raw files and images with extension stripping
    if (metadata?.type === 'application/pdf' || metadata?.name?.toLowerCase().endsWith('.pdf')) {
      resourceType = 'raw';
    } else {
      // For images, Cloudinary usually stores public_id WITHOUT extension.
      // If our path has an extension (like .jpg, .png), we should strip it.
      // But only if it looks like an extension (3-4 chars after dot).
      if (finalPath.match(/\.[a-z0-9]{3,4}$/i)) {
        finalPath = finalPath.replace(/\.[^/.]+$/, '');
      }
    }

    await cloudinaryService.deleteFile(finalPath, resourceType);
  }
}
