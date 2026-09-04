import { supabase } from '../supabase/supabase.config';
import { HttpError, httpErrorFrom } from '../utils/http.utils';
import { shouldUseMultipart } from '../../lib/multipart';
import { createMultipartUploader, type PartUploadOptions } from './multipart.upload';
import { uploadStore, type PendingUpload } from './upload-store';
import { apiUrl } from '../utils/api.utils';

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

/**
 * One PUT, with progress and the ability to give up halfway.
 *
 * XHR rather than fetch, and not for nostalgia: fetch still cannot report
 * upload progress, and a five-gigabyte file with no progress bar is
 * indistinguishable from a frozen tab.
 */
function putWithProgress(
  url: string,
  body: Blob,
  contentType: string,
  { signal, onProgress }: PartUploadOptions
): Promise<XMLHttpRequest> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType || 'application/octet-stream');

    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(event.loaded);
      };
    }

    const abort = () => xhr.abort();
    signal?.addEventListener('abort', abort, { once: true });

    const done = () => signal?.removeEventListener('abort', abort);

    xhr.onload = () => {
      done();
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr);
      else reject(new HttpError(`R2 upload failed with status ${xhr.status}`, xhr.status));
    };
    xhr.onerror = () => {
      done();
      reject(new Error('R2 upload network error'));
    };
    xhr.onabort = () => {
      done();
      reject(new DOMException('Upload aborted', 'AbortError'));
    };

    xhr.send(body);
  });
}

/** POST to one of the actions api/r2/[action].ts serves. */
async function callApi(action: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(apiUrl(`/api/r2/${action}`), {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    // 413 means the quota is full and 429 means too fast; both are answered
    // with a message worth showing, which httpErrorFrom carries through.
    throw await httpErrorFrom(res, `R2 ${action} failed`);
  }

  return (await res.json()) as Record<string, unknown>;
}

const uploader = createMultipartUploader({
  api: callApi,
  store: uploadStore,
  async putPart(url, blob, options) {
    const xhr = await putWithProgress(url, blob, 'application/octet-stream', options);
    const etag = xhr.getResponseHeader('ETag');

    if (!etag) {
      // Not a network failure and not worth retrying: the bucket's CORS rules
      // are not exposing the header, so no part will ever produce one. Said
      // plainly here because the alternative symptom — a completion rejected
      // with "InvalidPart" — points nowhere near the cause.
      throw new Error(
        'R2 did not expose the ETag header. Add ExposeHeaders: ["ETag"] to the bucket CORS policy.'
      );
    }

    return etag;
  },
});

const r2Service = {
  isConfigured(): boolean {
    return !!r2BucketName;
  },

  async uploadFile(
    file: File,
    _userId: string,
    onProgress?: (progress: number) => void,
    options?: { signal?: AbortSignal; folderId?: string | null }
  ): Promise<R2UploadResult> {
    if (!this.isConfigured()) {
      throw new Error('Cloudflare R2 is not configured.');
    }

    /* Big files go up in parts, and can be picked up again if they do not
       finish. Small ones keep the single PUT: the multipart handshake costs
       three extra round trips, which is most of the time budget for a file
       that would have been done in one. */
    const key = shouldUseMultipart(file.size)
      ? await uploader.start({
          file,
          folderId: options?.folderId ?? null,
          onProgress,
          signal: options?.signal,
        })
      : await this.uploadWhole(file, onProgress, options?.signal);

    const url = await this.getSignedDownloadUrl(key);
    return { key, url };
  },

  /** The single-PUT path, for anything under the multipart threshold. */
  async uploadWhole(
    file: File,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal
  ): Promise<string> {
    // 413 here means the storage quota is full — retrying cannot change that
    const { uploadUrl, key } = (await callApi('presign-upload', {
      fileName: file.name,
      contentType: file.type,
      size: file.size,
    })) as { uploadUrl: string; key: string };

    await putWithProgress(uploadUrl, file, file.type, {
      signal,
      onProgress: onProgress ? (loaded) => onProgress((loaded / file.size) * 100) : undefined,
    });

    return key;
  },

  /**
   * Uploads that were interrupted and can still be finished.
   *
   * Read from IndexedDB, so this survives the reload that produced them.
   */
  async resumableUploads(): Promise<PendingUpload[]> {
    return uploadStore.list();
  },

  /** Picks an interrupted upload back up where it stopped. */
  async resumeUpload(
    record: PendingUpload,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal
  ): Promise<R2UploadResult> {
    const key = await uploader.run(record, { onProgress, signal });
    return { key, url: await this.getSignedDownloadUrl(key) };
  },

  /** Abandons one, and tells R2 to release the parts it is holding. */
  async discardUpload(record: Pick<PendingUpload, 'key' | 'uploadId'>): Promise<void> {
    await uploader.abort(record);
  },

  /** How much of an interrupted upload is already in the bucket. */
  uploadedFraction(record: PendingUpload): number {
    if (record.partCount === 0) return 0;
    return record.completed.length / record.partCount;
  },

  async deleteFile(key: string): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('Cloudflare R2 is not configured.');
    }

    await callApi('delete', { key });
  },

  async getSignedDownloadUrl(key: string, expiresIn: number = 3600): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error('Cloudflare R2 is not configured.');
    }

    const { url } = (await callApi('presign-download', { key, expiresIn })) as { url: string };
    return url;
  },
};

export default r2Service;
