import * as Sentry from '../observability/sentry';
import { UploadProgress } from './storage.service';
import { supabase } from '../supabase/supabase.config';
import { httpErrorFrom } from '../utils/http.utils';

const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const deleteApiUrl = import.meta.env.VITE_CLOUDINARY_DELETE_API_URL;

/** What /api/cloudinary/sign hands back for exactly one upload. */
type UploadAuthorization = {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
  tags: string;
  resourceType: 'raw' | 'auto';
};

async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return {
    'Content-Type': 'application/json',
    ...(session?.access_token && { Authorization: `Bearer ${session.access_token}` }),
  };
}

/**
 * Asks the server to authorize this upload.
 *
 * Uploads used to go straight to Cloudinary with an unsigned preset, which
 * meant two things: anyone holding the cloud name — it ships in the client
 * bundle — could write into the account without having one here, and the
 * storage quota was checked on this path by nothing but the browser's own
 * good manners. The server now signs each upload, and refuses with 413 first.
 */
async function authorizeUpload(file: File): Promise<UploadAuthorization> {
  const response = await fetch('/api/cloudinary/sign', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ fileName: file.name, size: file.size, contentType: file.type }),
  });

  if (!response.ok) {
    // Carries the status, so a 413 is not retried the way a 502 is.
    throw await httpErrorFrom(response, 'Failed to authorize the upload');
  }

  return (await response.json()) as UploadAuthorization;
}

export type CloudinaryUploadResult = {
  publicId: string;
  url: string;
  format: string;
  bytes: number;
};

const cloudinaryService = {
  /**
   * Check if Cloudinary is configured
   */
  isConfigured(): boolean {
    return !!cloudName;
  },

  /**
   * Upload a file with a signature issued by our own server.
   */
  async uploadFile(
    file: File,
    _userId: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<CloudinaryUploadResult> {
    if (!this.isConfigured()) {
      throw new Error('Cloudinary is not configured correctly.');
    }

    // The server decides the folder, the tags and — for a PDF, which
    // Cloudinary stores as `raw` — the resource type. Sending anything here
    // that was not signed makes Cloudinary reject the upload outright.
    const auth = await authorizeUpload(file);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('api_key', auth.apiKey);
    formData.append('timestamp', String(auth.timestamp));
    formData.append('signature', auth.signature);
    formData.append('folder', auth.folder);
    formData.append('tags', auth.tags);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(
        'POST',
        `https://api.cloudinary.com/v1_1/${auth.cloudName}/${auth.resourceType}/upload`
      );

      if (onProgress) {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            onProgress({
              bytesTransferred: event.loaded,
              totalBytes: event.total,
              progress: (event.loaded / event.total) * 100,
            });
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const response = JSON.parse(xhr.responseText);
          resolve({
            publicId: response.public_id,
            url: response.secure_url,
            format: response.format,
            bytes: response.bytes,
          });
        } else {
          reject(new Error(`Cloudinary upload failed: ${xhr.responseText}`));
        }
      };

      xhr.onerror = () => reject(new Error('Cloudinary upload network error'));
      xhr.send(formData);
    });
  },

  /**
   * Delete file via proxy (since public API requires signature)
   */
  async deleteFile(publicId: string, resourceType?: string): Promise<void> {
    if (!deleteApiUrl) {
      console.warn('Cloudinary delete API URL not configured.');
      return;
    }

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const response = await fetch(deleteApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token && { Authorization: `Bearer ${session.access_token}` }),
        },
        body: JSON.stringify({ publicId, resourceType }),
      });

      if (!response.ok) {
        throw new Error('Failed to delete file from Cloudinary');
      }
    } catch (error) {
      Sentry.captureException(error, { tags: { context: 'cloudinary.deleteFile' } });
      throw error;
    }
  },
};

export default cloudinaryService;
