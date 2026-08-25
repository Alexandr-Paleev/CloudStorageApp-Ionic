import { supabase } from '../supabase/supabase.config';
import { HttpError, httpErrorFrom } from '../utils/http.utils';

const r2BucketName = import.meta.env.VITE_R2_BUCKET_NAME;

async function getAuthHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return {
    'Content-Type': 'application/json',
    ...(session?.access_token && { Authorization: `Bearer ${session.access_token}` }),
  };
}

export type R2UploadResult = {
  key: string;
  url: string;
};

const r2Service = {
  isConfigured(): boolean {
    return !!r2BucketName;
  },

  async uploadFile(
    file: File,
    _userId: string,
    onProgress?: (progress: number) => void
  ): Promise<R2UploadResult> {
    if (!this.isConfigured()) {
      throw new Error('Cloudflare R2 is not configured.');
    }

    const headers = await getAuthHeaders();

    // Get presigned upload URL from server
    const presignRes = await fetch('/api/r2/presign-upload', {
      method: 'POST',
      headers,
      body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size }),
    });

    if (!presignRes.ok) {
      // 413 here means the storage quota is full — retrying cannot change that
      throw await httpErrorFrom(presignRes, 'Failed to get upload URL');
    }

    const { uploadUrl, key } = await presignRes.json();

    // Upload directly to R2 via presigned URL with progress tracking
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

      if (onProgress) {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            onProgress((event.loaded / event.total) * 100);
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new HttpError(`R2 upload failed with status ${xhr.status}`, xhr.status));
        }
      };

      xhr.onerror = () => reject(new Error('R2 upload network error'));
      xhr.send(file);
    });

    const url = await this.getSignedDownloadUrl(key);
    return { key, url };
  },

  async deleteFile(key: string): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('Cloudflare R2 is not configured.');
    }

    const headers = await getAuthHeaders();
    const res = await fetch('/api/r2/delete', {
      method: 'POST',
      headers,
      body: JSON.stringify({ key }),
    });

    if (!res.ok) {
      throw await httpErrorFrom(res, 'Failed to delete from R2');
    }
  },

  async getSignedDownloadUrl(key: string, expiresIn: number = 3600): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error('Cloudflare R2 is not configured.');
    }

    const headers = await getAuthHeaders();
    const res = await fetch('/api/r2/presign-download', {
      method: 'POST',
      headers,
      body: JSON.stringify({ key, expiresIn }),
    });

    if (!res.ok) {
      throw await httpErrorFrom(res, 'Failed to get download URL');
    }

    const { url } = await res.json();
    return url;
  },
};

export default r2Service;
