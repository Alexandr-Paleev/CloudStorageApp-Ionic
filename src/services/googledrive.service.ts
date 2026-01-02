import { UploadProgress } from './storage.service';
import googleDriveAuthService from './googledrive-auth.service';

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
    ): Promise<any> {
        const token = await googleDriveAuthService.getAccessToken();
        if (!token) throw new Error('Google Drive not connected');

        const metadata = {
            name: file.name,
            parents: folderId ? [folderId] : [],
        };

        const formData = new FormData();
        formData.append(
            'metadata',
            new Blob([JSON.stringify(metadata)], { type: 'application/json' })
        );
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
                } else {
                    reject(new Error(`Google Drive upload failed: ${xhr.responseText}`));
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
        if (!token) throw new Error('Google Drive not connected');

        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
            method: 'DELETE',
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        if (!response.ok) {
            throw new Error('Failed to delete file from Google Drive');
        }
    },
};

export default googleDriveService;
