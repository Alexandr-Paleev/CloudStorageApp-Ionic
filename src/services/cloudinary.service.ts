import { UploadProgress } from './storage.service';

const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;
const deleteApiUrl = import.meta.env.VITE_CLOUDINARY_DELETE_API_URL;

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
        return !!(cloudName && uploadPreset);
    },

    /**
     * Upload file using unsigned upload preset
     */
    async uploadFile(
        file: File,
        userId: string,
        onProgress?: (progress: UploadProgress) => void
    ): Promise<CloudinaryUploadResult> {
        if (!this.isConfigured()) {
            throw new Error('Cloudinary is not configured correctly.');
        }

        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', uploadPreset || '');
        formData.append('folder', `users/${userId}`);
        formData.append('tags', `user_${userId}`);

        // Force 'raw' for PDFs to bypass default image/pdf security restrictions in some accounts
        const isPdf = file.name.toLowerCase().endsWith('.pdf');
        formData.append('resource_type', isPdf ? 'raw' : 'auto');

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `https://api.cloudinary.com/v1_1/${cloudName}/upload`);

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

        console.log(`[CloudinaryService] Deleting file. PublicID: "${publicId}", Type: "${resourceType}"`);

        try {
            const response = await fetch(deleteApiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ publicId, resourceType }),
            });

            if (!response.ok) {
                throw new Error('Failed to delete file from Cloudinary');
            }
        } catch (error) {
            console.error('Cloudinary delete error:', error);
            throw error;
        }
    },
};

export default cloudinaryService;
