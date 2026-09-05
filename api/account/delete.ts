import type { VercelRequest, VercelResponse } from '@vercel/node';
import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { v2 as cloudinary } from 'cloudinary';
import { authenticateUser, AuthError, supabase } from '../../lib/auth';
import { applyCors } from '../../lib/cors';
import { RateLimiter, clientIp, tooManyRequests } from '../../lib/rate-limit';
import { eraseAccount, type EraseDeps } from '../../lib/account-erase';
import { getS3Client, getR2BucketName } from '../../lib/r2';

/**
 * DELETE /api/account — erases the caller's account and everything under it.
 *
 * Both stores require this of any app that lets a person sign up: Apple in
 * guideline 5.1.1(v), Google in its account-deletion policy. Neither accepts a
 * support address, and neither accepts deactivation.
 *
 * It runs server-side because most of the work is beyond what the browser is
 * allowed to do: `auth.admin.deleteUser` needs the service-role key, and the
 * R2 and Cloudinary credentials never leave a function. The client holds a
 * session, not authority.
 *
 * There is no undo, which is the point.
 */

/* Deliberately tighter than the demo limiter. This is destructive and nobody
   has a legitimate reason to call it twice, let alone from a script. */
const limiter = new RateLimiter(5, 60 * 60 * 1000);

/** One S3 delete request takes at most 1000 keys. */
const S3_DELETE_BATCH = 1000;

/**
 * Removes every R2 object under this user's prefix.
 *
 * Listed and deleted in pages rather than derived from the `files` rows: a row
 * whose upload half-failed would leave an object no row names, and an erase
 * that trusts the rows would leave exactly those behind.
 */
async function eraseR2(userId: string): Promise<void> {
  const client = getS3Client();
  const Bucket = getR2BucketName();
  const Prefix = `users/${userId}/`;
  let ContinuationToken: string | undefined;

  do {
    const listed = await client.send(
      new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken })
    );
    const keys = (listed.Contents ?? [])
      .map((o) => ({ Key: o.Key as string }))
      .filter((o) => o.Key);

    for (let i = 0; i < keys.length; i += S3_DELETE_BATCH) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket,
          Delete: { Objects: keys.slice(i, i + S3_DELETE_BATCH), Quiet: true },
        })
      );
    }

    ContinuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (ContinuationToken);
}

/**
 * Removes every Cloudinary asset the user owns.
 *
 * By prefix, and for both resource types: images and raw files are separate
 * namespaces there, and `api/cloudinary/[action].ts` already carries the scar
 * of assuming otherwise. Videos are not a thing this app uploads.
 */
async function eraseCloudinary(userId: string): Promise<void> {
  for (const resource_type of ['image', 'raw'] as const) {
    await cloudinary.api.delete_resources_by_prefix(`users/${userId}/`, { resource_type });
  }
}

/** Absent rather than failing where a provider is not configured: a deployment
 *  with no R2 has no R2 objects to erase, and must still delete the account. */
function configuredProviders(): Omit<EraseDeps, 'supabase'> {
  const deps: Omit<EraseDeps, 'supabase'> = {};

  if (process.env.R2_ENDPOINT && process.env.R2_BUCKET_NAME) {
    deps.eraseR2 = eraseR2;
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME ?? process.env.VITE_CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (cloudName && apiKey && apiSecret) {
    cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
    deps.eraseCloudinary = eraseCloudinary;
  }

  return deps;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;

  if (req.method !== 'DELETE' && req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const ip = clientIp(req.headers, req.socket?.remoteAddress);
  if (!limiter.allow(ip)) {
    return tooManyRequests(
      res,
      limiter.retryAfterSeconds(ip),
      'Too many deletion attempts. Try again later.'
    );
  }

  try {
    const userId = await authenticateUser(req);

    const { failures } = await eraseAccount(userId, {
      supabase,
      ...configuredProviders(),
    });

    /* 200 with the list rather than a 500: the account is gone either way, and
       telling the caller their login still works would be a lie. */
    return res.status(200).json({ deleted: true, failures });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('Account deletion error:', error);
    return res.status(error instanceof AuthError ? 401 : 500).json({ message });
  }
}
