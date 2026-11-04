import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { v2 as cloudinary } from 'cloudinary';
import { BillingNotClosed, type EraseDeps } from './account-erase';
import { getS3Client, getR2BucketName } from './r2';
import { isMissingInStripe } from './stripe';
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
 * By prefix, and for every resource type: images, raw files and videos are
 * separate namespaces there, and `api/cloudinary/[action].ts` already carries
 * the scar of assuming otherwise. The app sends nothing to the video endpoint,
 * but the endpoint is a choice the browser makes — it is in the address, not
 * in the signature — so an upload signed for a raw file can arrive as a video,
 * and an erase of two types left it there.
 *
 * One call deletes at most 1000 assets. When there were more, the answer says
 * `partial` and carries a `next_cursor` for the call that continues; stopping
 * at the first answer left everything past the first thousand in place.
 */
async function eraseCloudinary(userId: string): Promise<void> {
  for (const resource_type of ['image', 'raw', 'video'] as const) {
    let next_cursor: string | undefined;

    do {
      const answer = (await cloudinary.api.delete_resources_by_prefix(
        ownerPrefix('cloudinary', userId),
        { resource_type, next_cursor }
      )) as { partial?: boolean; next_cursor?: string };

      next_cursor = answer.partial ? answer.next_cursor : undefined;
    } while (next_cursor);
  }
}

/**
 * Deletes the account's Stripe customer.
 *
 * Deleting a customer cancels its subscriptions at once, refunds nothing, and
 * removes the card details Stripe held for it; its history, invoices
 * included, stays in Stripe. Already deleted counts as done, so a second
 * attempt after an erase that failed halfway gets through.
 *
 * The SDK is loaded here and not at the top of the file: the demo sweep erases
 * through this module, and it would otherwise load Stripe on every cold start
 * for the one account in a hundred that opened a checkout.
 */
function closeBillingWith(key: string): (customerId: string) => Promise<void> {
  return async (customerId) => {
    const { default: Stripe } = await import('stripe');
    try {
      await new Stripe(key).customers.del(customerId);
    } catch (error) {
      if (isMissingInStripe(error)) return;
      console.error('Account erase: Stripe did not delete the customer:', error);
      throw new BillingNotClosed(
        'Your billing could not be closed with Stripe, so nothing was deleted. Try again in a moment.',
        502
      );
    }
  };
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

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (stripeKey) deps.closeBilling = closeBillingWith(stripeKey);

  return deps;
}
