import { UploadProgress } from './storage.service';
import googleDriveAuthService, { GoogleDriveAuthError } from './googledrive-auth.service';
import { HttpError } from '../utils/http.utils';
import { readAnswer, sendUpload } from './xhr-upload';

interface GoogleDriveFile {
  id: string;
  name: string;
  webViewLink: string;
}

/** What Google said, in words, rather than the JSON it said it in. */
function googleMessage(body: string): string {
  try {
    const message = (JSON.parse(body) as { error?: { message?: unknown } }).error?.message;
    if (typeof message === 'string' && message) return message;
  } catch {
    /* not JSON */
  }
  return 'Google Drive gave no reason';
}

/** A token that has run out, or been revoked, early or not: forgotten, so that
 *  the page offers to connect again instead of sending it once more. */
function refused(): GoogleDriveAuthError {
  googleDriveAuthService.forget();
  return new GoogleDriveAuthError();
}

const googleDriveService = {
  /**
   * Check if connected
   */
  async isConnected(): Promise<boolean> {
    return await googleDriveAuthService.isAuthorized();
  },

  /**
   * Upload file to Google Drive
   */
  async uploadFile(
    file: File,
    folderId?: string,
    onProgress?: (progress: UploadProgress) => void,
    signal?: AbortSignal
  ): Promise<GoogleDriveFile> {
    const token = await googleDriveAuthService.getAccessToken();
    if (!token) throw new GoogleDriveAuthError('Google Drive is not connected');

    const metadata = {
      name: file.name,
      parents: folderId ? [folderId] : [],
    };

    const formData = new FormData();
    formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    formData.append('file', file);

    const xhr = await sendUpload({
      provider: 'Google Drive',
      method: 'POST',
      url: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
      signal,
      onProgress:
        onProgress &&
        ((loaded, total) =>
          onProgress({
            bytesTransferred: loaded,
            totalBytes: total,
            progress: (loaded / total) * 100,
          })),
      /* With the status now. Without one the retry helper sent a file Drive
         had refused, a full Drive among them, twice more. */
      refusal: (xhr) =>
        xhr.status === 401
          ? refused()
          : new HttpError(
              `Google Drive upload failed: ${googleMessage(xhr.responseText)}`,
              xhr.status
            ),
    });

    return readAnswer<GoogleDriveFile>(xhr, 'Google Drive');
  },

  /**
   * Delete file from Google Drive
   */
  async deleteFile(fileId: string): Promise<void> {
    const token = await googleDriveAuthService.getAccessToken();
    if (!token) throw new GoogleDriveAuthError('Google Drive is not connected');

    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    /* Already gone — deleted in Drive itself, or by an earlier attempt whose
       answer never arrived — is the state this call exists to reach. Thrown,
       it kept the file in the app for good: the row goes only after the
       provider has said yes, and Drive would say 404 every time. */
    if (response.status === 404) return;
    if (response.status === 401) throw refused();

    if (!response.ok) {
      throw new Error('Failed to delete file from Google Drive');
    }
  },
};

export default googleDriveService;
