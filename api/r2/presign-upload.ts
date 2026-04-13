import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { authenticateUser } from '../lib/auth';
import { getS3Client, getR2BucketName } from '../lib/r2';
import path from 'path';

function sanitizeFileName(name: string): string {
  // Extract basename to prevent path traversal (../../ etc)
  const base = path.basename(name);
  // Remove any remaining dangerous characters
  return base.replace(/[^\w.\-() ]/g, '_') || 'unnamed';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const userId = await authenticateUser(req);

    const { fileName, contentType } = req.body as {
      fileName?: string;
      contentType?: string;
    };

    if (!fileName) {
      return res.status(400).json({ message: 'fileName is required' });
    }

    const safeName = sanitizeFileName(fileName);
    const key = `users/${userId}/${Date.now()}_${safeName}`;

    const command = new PutObjectCommand({
      Bucket: getR2BucketName(),
      Key: key,
      ContentType: contentType || 'application/octet-stream',
    });

    const uploadUrl = await getSignedUrl(getS3Client(), command, { expiresIn: 3600 });

    return res.status(200).json({ uploadUrl, key });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message.includes('token') ? 401 : 500;
    console.error('R2 presign-upload error:', error);
    return res.status(status).json({ message });
  }
}
