import * as Sentry from '../observability/sentry';
import { supabase } from '../supabase/supabase.config';
import { UploadProgress } from './storage.service';

const BUCKET_NAME = 'files';

const supabaseStorageService = {
  /**
   * Upload file to Supabase Storage
   * Paths are structured as: {userId}/{fileName}_{timestamp}
   */
  async uploadFile(
    file: File,
    userId: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<{ path: string; url: string }> {
    const timestamp = Date.now();
    const fileName = file.name.replace(/[^a-zA-Z0-9.]/g, '_');
    const filePath = `${userId}/${timestamp}_${fileName}`;

    // Basic progress simulation since Supabase JS SDK doesn't natively expose XHR progress easily in this version
    // Ideally we'd use a more low-level approach for real progress, but for now we'll do 0/100
    if (onProgress) onProgress({ bytesTransferred: 0, totalBytes: file.size, progress: 10 });

    const { data, error } = await supabase.storage.from(BUCKET_NAME).upload(filePath, file, {
      cacheControl: '3600',
      upsert: false,
    });

    if (error) {
      Sentry.captureException(error, { tags: { context: 'supabaseStorage.uploadFile' } });
      throw error;
    }

    if (onProgress)
      onProgress({ bytesTransferred: file.size, totalBytes: file.size, progress: 100 });

    // Get a signed URL for immediate viewing (valid for 1 hour)
    // Note: For long-term storage, we store the path and generate a new signed URL on demand
    // or use an edge-function/proxy if we want persistent URLs without public buckets.
    const { data: urlData, error: urlError } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(data.path, 3600); // 1 hour

    if (urlError) {
      Sentry.captureException(urlError, {
        tags: { context: 'supabaseStorage.uploadFile.signUrl' },
      });
      throw urlError;
    }

    return {
      path: data.path,
      url: urlData.signedUrl,
    };
  },

  /**
   * Delete file from Supabase Storage
   */
  async deleteFile(path: string): Promise<void> {
    const { error } = await supabase.storage.from(BUCKET_NAME).remove([path]);

    if (error) {
      Sentry.captureException(error, { tags: { context: 'supabaseStorage.deleteFile' } });
      throw error;
    }
  },

  /**
   * Get a temporary signed URL for a file
   */
  async getSignedUrl(path: string): Promise<string> {
    const { data, error } = await supabase.storage.from(BUCKET_NAME).createSignedUrl(path, 3600);

    if (error) {
      Sentry.captureException(error, { tags: { context: 'supabaseStorage.getSignedUrl' } });
      throw error;
    }

    return data.signedUrl;
  },
};

export default supabaseStorageService;
