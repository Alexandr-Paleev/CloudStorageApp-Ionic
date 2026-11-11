import { UploadProgress } from './storage.service';
import dropboxAuthService from './dropbox-auth.service';
import { toDirectLink } from '../utils/dropbox.utils';
import { HttpError } from '../utils/http.utils';
import { readAnswer, sendUpload } from './xhr-upload';

interface DropboxUploadResult {
  id: string;
  name: string;
  path_display: string;
}

const dropboxService = {
  async isConnected(): Promise<boolean> {
    return dropboxAuthService.isAuthorized();
  },

  async uploadFile(
    file: File,
    userId: string,
    onProgress?: (progress: UploadProgress) => void,
    signal?: AbortSignal
  ): Promise<{ id: string; sharedLink: string }> {
    const token = await dropboxAuthService.getAccessToken();
    if (!token) throw new Error('Dropbox not connected');

    const path = `/CloudStorage/${userId}/${Date.now()}_${file.name}`;

    // Upload file
    const xhr = await sendUpload({
      provider: 'Dropbox',
      method: 'POST',
      url: 'https://content.dropboxapi.com/2/files/upload',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({ path, mode: 'add', autorename: true, mute: false }),
      },
      body: file,
      signal,
      onProgress:
        onProgress &&
        ((loaded, total) =>
          onProgress({
            bytesTransferred: loaded,
            totalBytes: total,
            progress: (loaded / total) * 100,
          })),
      refusal: (xhr) => new HttpError(`Dropbox upload failed: ${xhr.responseText}`, xhr.status),
    });
    const uploadResponse = readAnswer<DropboxUploadResult>(xhr, 'Dropbox');

    // Create shared link
    const linkResponse = await fetch(
      'https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path: uploadResponse.path_display,
          settings: { requested_visibility: 'public' },
        }),
      }
    );

    let sharedLink: string;
    if (linkResponse.ok) {
      const linkData = await linkResponse.json();
      sharedLink = toDirectLink(linkData.url);
    } else {
      // If shared link already exists, get it
      const existingResponse = await fetch(
        'https://api.dropboxapi.com/2/sharing/list_shared_links',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ path: uploadResponse.path_display }),
        }
      );
      const existingData = await existingResponse.json();
      const existingUrl = existingData.links?.[0]?.url;
      sharedLink = existingUrl ? toDirectLink(existingUrl) : uploadResponse.path_display;
    }

    return { id: uploadResponse.path_display, sharedLink };
  },

  async deleteFile(path: string): Promise<void> {
    const token = await dropboxAuthService.getAccessToken();
    if (!token) throw new Error('Dropbox not connected');

    const response = await fetch('https://api.dropboxapi.com/2/files/delete_v2', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path }),
    });

    if (!response.ok) {
      throw new Error('Failed to delete file from Dropbox');
    }
  },
};

export default dropboxService;
