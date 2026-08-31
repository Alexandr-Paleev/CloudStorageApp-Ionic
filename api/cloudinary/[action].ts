import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateUser, AuthError, supabase } from '../../lib/auth';
import { readQuota, quotaRejection } from '../../lib/quota';

/**
 * Two actions, one serverless function: /api/cloudinary/sign and
 * /api/cloudinary/delete.
 *
 * They share a file because Vercel turns every file under api/ into its own
 * function and the Hobby plan allows twelve — which this repository already
 * has. A dynamic segment costs nothing and keeps signing uploads from needing
 * a thirteenth. See resolveHandler() in vite-plugin-dev-api.ts for the dev
 * server's side of the same routing.
 */

/**
 * Images go to Cloudinary's image endpoint; everything else is `raw`.
 *
 * Not `auto`. Auto decides for itself, and the decision has to be one that
 * CloudinaryProvider.delete can reproduce months later from the stored row —
 * it is the difference between deleting the asset and leaving it in the
 * account forever, uncounted. Images keep no extension in their public_id,
 * raw assets do, and both sides now split on the same question.
 */
function resourceTypeFor(fileName: string, contentType?: string): 'raw' | 'image' {
  const isImage =
    contentType?.startsWith('image/') ?? /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(fileName);
  return isImage ? 'image' : 'raw';
}

function configureCloudinary(cloudinary: { config: (options: Record<string, string>) => void }) {
  // Server-side names only: a VITE_ prefixed fallback would be inlined into
  // the public client bundle by Vite.
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
    api_key: process.env.CLOUDINARY_API_KEY || '',
    api_secret: process.env.CLOUDINARY_API_SECRET || '',
  });
}

/**
 * Authorizes one upload into the caller's own folder.
 *
 * Replaces an unsigned upload preset. That preset let anything with the cloud
 * name — which ships in the client bundle — write into this account without
 * an account here at all, and it meant the quota was checked nowhere on the
 * path production actually uses for images.
 */
async function signUpload(req: VercelRequest, res: VercelResponse, userId: string): Promise<void> {
  const { fileName, size, contentType } = req.body as {
    fileName?: string;
    size?: number;
    contentType?: string;
  };

  if (!fileName) {
    res.status(400).json({ message: 'fileName is required' });
    return;
  }

  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) {
    res.status(400).json({ message: 'size (in bytes) is required' });
    return;
  }

  const rejection = quotaRejection(await readQuota(userId), size);
  if (rejection) {
    res.status(413).json({ message: rejection });
    return;
  }

  const secret = process.env.CLOUDINARY_API_SECRET;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (!secret || !apiKey || !cloudName) {
    // 501, not 500: the client cannot see the server's variables, so
    // isConfigured() still routes images here on a half-configured
    // deployment. A 500 would be retried twice on the way to the same answer.
    res.status(501).json({ message: 'Cloudinary is not configured on the server' });
    return;
  }

  const cloudinary = (await import('cloudinary')).v2;
  configureCloudinary(cloudinary);

  // No public_id: Cloudinary picks a unique one inside the folder, so an
  // upload cannot land on top of an asset that already exists. The folder is
  // what binds the asset to its owner — /api/cloudinary/delete checks exactly
  // this prefix before destroying anything.
  const timestamp = Math.round(Date.now() / 1000);
  const params = {
    folder: `users/${userId}`,
    tags: `user_${userId}`,
    timestamp,
  };

  res.status(200).json({
    ...params,
    cloudName,
    // Public by design: it travels with every signed browser upload. The
    // secret never leaves this function.
    apiKey,
    signature: cloudinary.utils.api_sign_request(params, secret),
    resourceType: resourceTypeFor(fileName, contentType),
  });
}

function stripExtension(path: string): string {
  return path.replace(/\.[^/.]+$/, '');
}

/**
 * CloudinaryProvider strips the extension from image public_ids before calling
 * this endpoint, so a stored path of users/<id>/photo.jpg arrives here as
 * users/<id>/photo — both forms have to be accepted.
 */
async function ownsAsset(userId: string, publicId: string): Promise<boolean> {
  // Fast path: uploads go into a per-user folder (see cloudinary.service.ts)
  if (publicId.startsWith(`users/${userId}/`)) return true;

  // Fallback for Cloudinary accounts using dynamic folders, where the folder is
  // stored separately and is not part of the public_id.
  const { data } = await supabase
    .from('files')
    .select('storage_path')
    .eq('user_id', userId)
    .eq('storage_type', 'cloudinary');

  const rows = (data || []) as { storage_path: string }[];
  return rows.some(
    (row) => row.storage_path === publicId || stripExtension(row.storage_path) === publicId
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  try {
    const userId = await authenticateUser(req);

    const action = Array.isArray(req.query.action) ? req.query.action[0] : req.query.action;
    if (action === 'sign') {
      await signUpload(req, res, userId);
      return;
    }
    if (action !== 'delete') {
      res.status(404).json({ message: `Unknown action "${action ?? ''}"` });
      return;
    }

    const cloudinary = (await import('cloudinary')).v2;
    configureCloudinary(cloudinary);

    const { publicId, resourceType } = req.body as { publicId?: string; resourceType?: string };

    if (!publicId) {
      res.status(400).json({ message: 'publicId is required' });
      return;
    }

    if (!(await ownsAsset(userId, publicId))) {
      res.status(403).json({ message: 'Access denied' });
      return;
    }

    // Determine options based on passed resourceType or default fallback
    // If resourceType is explicit (e.g. 'raw' for PDF), use it.
    // Otherwise default to 'image'.
    const options = resourceType ? { resource_type: resourceType } : { resource_type: 'image' };

    let result = await cloudinary.uploader.destroy(publicId, options);

    // The stored row is the only record of which endpoint an asset went to,
    // and rows written before signing existed went through `auto`, which chose
    // for itself. So a miss is retried against the other endpoint — in both
    // directions, since the caller now names 'raw' explicitly.
    if (result.result === 'not found') {
      const fallback = options.resource_type === 'raw' ? 'image' : 'raw';
      result = await cloudinary.uploader.destroy(publicId, { resource_type: fallback });
    }

    if (result.result === 'ok' || result.result === 'not found') {
      res.status(200).json({
        success: true,
        message:
          result.result === 'not found'
            ? 'File not found (may already be deleted)'
            : 'Deleted successfully',
        details: result,
      });
      return;
    } else {
      console.error(`[Cloudinary] Deletion failed:`, result);
      res.status(500).json({
        message: `Failed to delete file from Cloudinary: ${result.result}`,
        details: result,
      });
      return;
    }
  } catch (error) {
    // Shared by both actions, so it says neither "upload" nor "delete". The
    // key is `message` throughout: httpErrorFrom() on the client reads that
    // one, and a mismatch turned every failure here — an expired session, a
    // missing migration — into a bare "Failed to authorize the upload".
    console.error('[cloudinary]', error);
    res.status(error instanceof AuthError ? 401 : 500).json({
      message: error instanceof Error ? error.message : 'Unknown server error',
    });
    return;
  }
}
