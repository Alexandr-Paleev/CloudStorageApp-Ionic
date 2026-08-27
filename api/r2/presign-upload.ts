import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { authenticateUser, AuthError, supabase } from '../../lib/auth';
import { getS3Client, getR2BucketName } from '../../lib/r2';
import { sanitizeFileName } from '../../lib/filename';
import { formatBytes } from '../../lib/format';
import { DEFAULT_STORAGE_LIMIT } from '../../lib/tiers';

async function getStorageLimit(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('profiles')
    .select('storage_limit')
    .eq('id', userId)
    .limit(1);

  // Never fall through to the default on a failed read: that would silently cap
  // a Pro user at the free tier and reject a legitimate upload with 413.
  if (error) throw new Error(`Failed to read storage limit: ${error.message}`);

  const rows = (data || []) as { storage_limit: number }[];
  return rows[0]?.storage_limit ?? DEFAULT_STORAGE_LIMIT;
}

/**
 * Paged on purpose: PostgREST caps how many rows it returns, and an undercount
 * here would hand out upload URLs beyond the user's quota.
 */
async function getStorageUsed(userId: string): Promise<number> {
  const pageSize = 1000;
  let total = 0;
  let page = 0;

  for (;;) {
    const { data, error } = await supabase
      .from('files')
      .select('size')
      .eq('user_id', userId)
      .range(page * pageSize, page * pageSize + pageSize - 1);

    if (error) throw new Error(`Failed to read current storage usage: ${error.message}`);

    const rows = (data || []) as { size: number }[];
    total += rows.reduce((sum, row) => sum + row.size, 0);

    if (rows.length < pageSize) return total;
    page += 1;
  }
}

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

    // The quota has to be enforced here. The client-side check is advisory, and
    // a presigned URL writes straight to the bucket without touching this API.
    const [limit, used] = await Promise.all([getStorageLimit(userId), getStorageUsed(userId)]);

    if (used + size > limit) {
      // A downgrade can leave an account above its new limit, so this is not
      // only the "almost full" case — say plainly where the user stands.
      const overBy = used > limit ? ` You are ${formatBytes(used - limit)} over the limit.` : '';
      return res.status(413).json({
        message:
          `Storage limit exceeded. Using ${formatBytes(used)} of ${formatBytes(limit)}, ` +
          `and this file needs ${formatBytes(size)} more.${overBy}`,
      });
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
