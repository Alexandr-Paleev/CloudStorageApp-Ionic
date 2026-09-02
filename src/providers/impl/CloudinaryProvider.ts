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
      // Cloudinary stores what it stores; the file that left the browser is
      // not always the same size as the asset that arrives.
      bytes: result.bytes,
    };
  }

  async delete(path: string, metadata?: { type?: string; name?: string }): Promise<void> {
    let resourceType: string | undefined;
    let finalPath = path;

    // Same split as resourceTypeFor() in api/cloudinary/[action].ts, which
    // decided where the asset went in the first place: images to the image
    // endpoint, everything else to raw. It used to ask "is this a PDF", which
    // sent a .txt to the image branch and quietly failed to delete it — the
    // row went away and the asset stayed, uncounted, forever.
    const isImage = metadata?.type?.startsWith('image/') ?? false;

    if (isImage) {
      // Cloudinary drops the extension from an image's public_id. Strip it
      // here too, but only when it looks like one.
      if (finalPath.match(/\.[a-z0-9]{3,4}$/i)) {
        finalPath = finalPath.replace(/\.[^/.]+$/, '');
      }
    } else {
      resourceType = 'raw';
    }

    await cloudinaryService.deleteFile(finalPath, resourceType);
  }
}
