import { UploadProgress } from './storage.service';
import googleDriveAuthService, { GoogleDriveAuthError } from './googledrive-auth.service';

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
    onProgress?: (progress: UploadProgress) => void
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

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(
        'POST',
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink'
      );
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);

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
          resolve(JSON.parse(xhr.responseText));
        } else if (xhr.status === 401) {
          reject(refused());
        } else {
          reject(new Error(`Google Drive upload failed: ${googleMessage(xhr.responseText)}`));
        }
      };

      xhr.onerror = () => reject(new Error('Google Drive upload network error'));
      xhr.send(formData);
    });
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
