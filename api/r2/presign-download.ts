import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { authenticateUser, AuthError } from '../lib/auth';
import { getS3Client, getR2BucketName } from '../lib/r2';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const userId = await authenticateUser(req);

    const { key, expiresIn } = req.body as { key?: string; expiresIn?: number };

    if (!key) {
      return res.status(400).json({ message: 'key is required' });
    }

    if (!key.startsWith(`users/${userId}/`)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const command = new GetObjectCommand({
      Bucket: getR2BucketName(),
      Key: key,
    });

    const url = await getSignedUrl(getS3Client(), command, { expiresIn: expiresIn || 3600 });

    return res.status(200).json({ url });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('R2 presign-download error:', error);
    return res.status(error instanceof AuthError ? 401 : 500).json({ message });
  }
}
