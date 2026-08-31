import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { authenticateUser, AuthError } from '../../lib/auth';
import { getS3Client, getR2BucketName } from '../../lib/r2';
import { sanitizeFileName } from '../../lib/filename';
import { readQuota, quotaRejection } from '../../lib/quota';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const userId = await authenticateUser(req);

    const { fileName, contentType, size } = req.body as {
      fileName?: string;
      contentType?: string;
      size?: number;
    };

    if (!fileName) {
      return res.status(400).json({ message: 'fileName is required' });
    }

    if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) {
      return res.status(400).json({ message: 'size (in bytes) is required' });
    }

    // Refuse before the bytes travel. This is not the last line of defence —
    // that is the trigger on public.files, which also covers the providers
    // that upload straight from the browser and never reach this handler.
    const rejection = quotaRejection(await readQuota(userId), size);
    if (rejection) {
      return res.status(413).json({ message: rejection });
    }

    const safeName = sanitizeFileName(fileName);
    const key = `users/${userId}/${Date.now()}_${safeName}`;

    const command = new PutObjectCommand({
      Bucket: getR2BucketName(),
      Key: key,
      ContentType: contentType || 'application/octet-stream',
      // Lands in X-Amz-SignedHeaders, so the approved size cannot be exceeded
      // after the URL has been handed out.
      ContentLength: size,
    });

    const uploadUrl = await getSignedUrl(getS3Client(), command, { expiresIn: 3600 });

    return res.status(200).json({ uploadUrl, key });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('R2 presign-upload error:', error);
    return res.status(error instanceof AuthError ? 401 : 500).json({ message });
  }
}
