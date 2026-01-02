import {
    S3Client,
    DeleteObjectCommand,
    GetObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const r2BucketName = import.meta.env.VITE_R2_BUCKET_NAME;
const r2Endpoint = import.meta.env.VITE_R2_ENDPOINT;
const r2AccessKeyId = import.meta.env.VITE_R2_ACCESS_KEY_ID;
const r2SecretAccessKey = import.meta.env.VITE_R2_SECRET_ACCESS_KEY;

const isR2Configured = !!(
    r2BucketName &&
    r2Endpoint &&
    r2AccessKeyId &&
    r2SecretAccessKey
);

const s3Client = new S3Client({
    region: 'auto',
    endpoint: r2Endpoint,
    credentials: {
        accessKeyId: r2AccessKeyId || '',
        secretAccessKey: r2SecretAccessKey || '',
    },
});

export type R2UploadResult = {
    key: string;
    url: string;
};

const r2Service = {
    isConfigured(): boolean {
        return isR2Configured;
    },

    async uploadFile(
        file: File,
        userId: string,
        onProgress?: (progress: number) => void
    ): Promise<R2UploadResult> {
        if (!isR2Configured) {
            throw new Error('Cloudflare R2 is not configured.');
        }

        const timestamp = Date.now();
        const key = `users/${userId}/${timestamp}_${file.name}`;

        try {
            const parallelUploads3 = new Upload({
                client: s3Client,
                params: {
                    Bucket: r2BucketName,
                    Key: key,
                    Body: file,
                    ContentType: file.type,
                },
                queueSize: 4,
                partSize: 1024 * 1024 * 5,
                leavePartsOnError: false,
            });

            if (onProgress) {
                parallelUploads3.on('httpUploadProgress', (progress) => {
                    if (progress.loaded && progress.total) {
                        onProgress((progress.loaded / progress.total) * 100);
                    }
                });
            }

            await parallelUploads3.done();

            const url = await this.getSignedDownloadUrl(key);
            return { key, url };
        } catch (error) {
            console.error('R2 Upload Error:', error);
            throw error;
        }
    },

    async deleteFile(key: string): Promise<void> {
        if (!isR2Configured) {
            throw new Error('Cloudflare R2 is not configured.');
        }

        const command = new DeleteObjectCommand({
            Bucket: r2BucketName,
            Key: key,
        });

        try {
            await s3Client.send(command);
        } catch (error) {
            console.error('R2 Delete Error:', error);
            throw error;
        }
    },

    async getSignedDownloadUrl(key: string, expiresIn: number = 3600): Promise<string> {
        if (!isR2Configured) {
            throw new Error('Cloudflare R2 is not configured.');
        }

        const command = new GetObjectCommand({
            Bucket: r2BucketName,
            Key: key,
        });

        try {
            return await getSignedUrl(s3Client, command, { expiresIn });
        } catch (error) {
            console.error('R2 Signed URL Error:', error);
            throw error;
        }
    },
};

export default r2Service;
