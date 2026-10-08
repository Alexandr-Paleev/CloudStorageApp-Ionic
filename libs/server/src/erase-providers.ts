import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { v2 as cloudinary } from 'cloudinary';
import type { EraseDeps } from './account-erase';
import { getS3Client, getR2BucketName } from './r2';
import { ownerPrefix } from '../../core/src/stored-path';

/**
 * The storage providers `eraseAccount` can be handed, as this deployment has
 * them configured.
 *
 * Shared by the two routes that erase an account: DELETE /api/account, when a
 * person asks, and /api/demo/session, when a demo account ages out. The second
 * one used to do its own, shorter sweep, and every image a demo visitor had
 * uploaded stayed in Cloudinary for good.
 */

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
  const Prefix = ownerPrefix('r2', userId);
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
    await cloudinary.api.delete_resources_by_prefix(ownerPrefix('cloudinary', userId), {
      resource_type,
    });
  }
}

/** Absent rather than failing where a provider is not configured: a deployment
 *  with no R2 has no R2 objects to erase, and must still delete the account. */
export function configuredProviders(): Omit<EraseDeps, 'supabase'> {
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
