import type { VercelRequest, VercelResponse } from '@vercel/node';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { authenticateUser, AuthError } from '../lib/auth';
import { getS3Client, getR2BucketName } from '../lib/r2';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const userId = await authenticateUser(req);

    const { key } = req.body as { key?: string };

    if (!key) {
      return res.status(400).json({ message: 'key is required' });
    }

    if (!key.startsWith(`users/${userId}/`)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await getS3Client().send(
      new DeleteObjectCommand({
        Bucket: getR2BucketName(),
        Key: key,
      })
    );

    return res.status(200).json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('R2 delete error:', error);
    return res.status(error instanceof AuthError ? 401 : 500).json({ message });
  }
}
