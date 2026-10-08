import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { supabase } from './auth';
import { getS3Client, getR2BucketName } from './r2';
import { ownsStoredPath } from '../../core/src/stored-path';

/** The Supabase Storage bucket every upload goes to. */
const BUCKET = 'files';

/** A row names an object outside its owner's own storage. */
export class NotOwnedError extends Error {}

/**
 * A short-lived URL for a private object, signed only once its path is shown
 * to be the owner's.
 *
 * R2 and Supabase Storage keep private objects, and this function signs them
 * with the deployment's own credentials — the R2 keys and the service-role key,
 * neither of which cares whose object a path names. The path comes from a
 * `files` row, and the row is the browser's writing: RLS decides whose row it
 * is, never what it says. So the check lives here, in the one function that
 * signs, rather than in each route that calls it, and a route that forgets to
 * ask can no longer sign another account's object. `/api/share` and the
 * indexer both come through here.
 *
 * Returns null for the providers that store a delivery URL instead of a private
 * object — Cloudinary, Google Drive and Dropbox. The caller decides what to do
 * with that URL, because what makes it safe differs: the share page needs
 * http(s), and the indexer needs the caller's own Cloudinary folder.
 */
export async function signOwnedPath(
  file: { storage_type: string; storage_path: string },
  ownerId: string,
  ttlSeconds: number
): Promise<string | null> {
  if (file.storage_type !== 'r2' && file.storage_type !== 'supabase_storage') return null;

  if (!ownsStoredPath(file, ownerId)) {
    throw new NotOwnedError('The stored location for this file does not belong to its owner');
  }

  if (file.storage_type === 'r2') {
    return getSignedUrl(
      getS3Client(),
      new GetObjectCommand({ Bucket: getR2BucketName(), Key: file.storage_path }),
      { expiresIn: ttlSeconds }
    );
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(file.storage_path, ttlSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(`Could not sign a URL: ${error?.message ?? 'no URL returned'}`);
  }
  return data.signedUrl;
}
