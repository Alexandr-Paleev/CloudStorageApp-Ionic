import { UploadProgress } from './storage.service';
import dropboxAuthService from './dropbox-auth.service';
import { toDirectLink } from '../utils/dropbox.utils';

interface DropboxUploadResult {
  id: string;
  name: string;
  path_display: string;
}

const dropboxService = {
  isConnected(): boolean {
    return dropboxAuthService.isAuthorized();
  },

  async uploadFile(
    file: File,
    userId: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<{ id: string; sharedLink: string }> {
    const token = await dropboxAuthService.getAccessToken();
    if (!token) throw new Error('Dropbox not connected');

    const path = `/CloudStorage/${userId}/${Date.now()}_${file.name}`;

    // Upload file
    const uploadResponse = await new Promise<DropboxUploadResult>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', 'https://content.dropboxapi.com/2/files/upload');
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader(
        'Dropbox-API-Arg',
        JSON.stringify({
          path,
          mode: 'add',
          autorename: true,
          mute: false,
        })
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
          resolve(JSON.parse(xhr.responseText));
        } else {
          reject(new Error(`Dropbox upload failed: ${xhr.responseText}`));
        }
      };

      xhr.onerror = () => reject(new Error('Dropbox upload network error'));
      xhr.send(file);
    });

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
