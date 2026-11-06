import * as Sentry from '../observability/sentry';
import { env } from '../env';
import { supabase } from '../supabase/supabase.config';
import { HttpError } from '../utils/http.utils';
import { UploadProgress } from './storage.service';

const BUCKET_NAME = 'files';

/**
 * What supabase-js sends for a file, sent through XHR so that progress can be
 * read: the same form, the file under an empty name, no overwrite, and the
 * same two headers its client adds to every request.
 *
 * supabase-js uploads with fetch, which says nothing until the last byte has
 * gone. The bar was drawn instead, at 10% and then 100%, and a 40 MB PDF on a
 * slow connection sat at 10% for minutes.
 */
function sendWithProgress(
  signedUrl: string,
  file: File,
  accessToken: string | undefined,
  onProgress?: (progress: UploadProgress) => void
): Promise<void> {
  const body = new FormData();
  body.append('cacheControl', '3600');
  body.append('', file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', signedUrl);
    xhr.setRequestHeader('apikey', env.VITE_SUPABASE_ANON_KEY);
    if (accessToken) xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.setRequestHeader('x-upsert', 'false');

    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        // The form around the file counts too, so the last event can pass it.
        onProgress({
          bytesTransferred: Math.min(event.loaded, file.size),
          totalBytes: file.size,
          progress: (event.loaded / event.total) * 100,
        });
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      // With the status, so the retry helper does not send a refused file twice more.
      let message = 'Upload to Supabase Storage failed';
      try {
        message = (JSON.parse(xhr.responseText) as { message?: string }).message || message;
      } catch {
        /* not JSON: the fallback says enough */
      }
      reject(new HttpError(message, xhr.status));
    };
    xhr.onerror = () => reject(new Error('Supabase Storage upload network error'));
    xhr.send(body);
  });
}

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

    /* Signed by the signed-in account, for this path alone, so the bucket's
       policies are asked here as they are for any upload. The address takes
       one object, and nothing else is needed to send it. */
    const { data: signed, error: signError } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUploadUrl(filePath);

    if (signError) {
      Sentry.captureException(signError, { tags: { context: 'supabaseStorage.uploadFile' } });
      throw signError;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    try {
      await sendWithProgress(signed.signedUrl, file, session?.access_token, onProgress);
    } catch (error) {
      Sentry.captureException(error, { tags: { context: 'supabaseStorage.uploadFile' } });
      throw error;
    }

    // Get a signed URL for immediate viewing (valid for 1 hour)
    // Note: For long-term storage, we store the path and generate a new signed URL on demand
    // or use an edge-function/proxy if we want persistent URLs without public buckets.
    const { data: urlData, error: urlError } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(filePath, 3600); // 1 hour

    if (urlError) {
      Sentry.captureException(urlError, {
        tags: { context: 'supabaseStorage.uploadFile.signUrl' },
      });
      throw urlError;
    }

    return {
      path: filePath,
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
