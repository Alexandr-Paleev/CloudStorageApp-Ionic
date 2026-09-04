import * as Sentry from '../observability/sentry';
import { UploadProgress } from './storage.service';
import { supabase } from '../supabase/supabase.config';
import { httpErrorFrom } from '../utils/http.utils';
import { apiUrl } from '../utils/api.utils';

const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
/**
 * Same origin by default. The variable is kept because deployments set it, but
 * an absolute URL is the wrong default twice over: a preview build then
 * deletes assets against production, and an unset variable used to make
 * deletion a silent no-op — which stopped being cosmetic once the quota
 * rollback started relying on it to remove an asset whose row was refused.
 */
const deleteApiUrl =
  import.meta.env.VITE_CLOUDINARY_DELETE_API_URL || apiUrl('/api/cloudinary/delete');

/** What /api/cloudinary/sign hands back for exactly one upload. */
type UploadAuthorization = {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
  tags: string;
  resourceType: 'raw' | 'image';
};

/**
 * Set once /api/cloudinary/sign has answered 501. Uploads used to fall through
 * to R2 or Supabase Storage when Cloudinary was unconfigured, because the
 * client could tell from VITE_CLOUDINARY_UPLOAD_PRESET; with signing, only the
 * server knows, and it can only say so by being asked.
 */
let serverCannotSign = false;

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
  const response = await fetch(apiUrl('/api/cloudinary/sign'), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ fileName: file.name, size: file.size, contentType: file.type }),
  });

  if (!response.ok) {
    // 501 means this deployment has no Cloudinary credentials server-side.
    // The client cannot see that on its own — isConfigured() only knows the
    // cloud name — so remember it, and let the next upload be routed to a
    // backend that does work instead of failing the same way again.
    if (response.status === 501) serverCannotSign = true;

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
    return !!cloudName && !serverCannotSign;
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
