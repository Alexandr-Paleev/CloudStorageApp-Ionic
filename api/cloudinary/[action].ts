import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateUser, AuthError, supabase } from '../../lib/auth';
import { readQuota, quotaRejection } from '../../lib/quota';
import {
  CLOUDINARY_DELETE_LIMIT,
  CLOUDINARY_IP_LIMIT,
  CLOUDINARY_SIGN_LIMIT,
  RateLimiter,
  clientIp,
  tooManyRequests,
} from '../../lib/rate-limit';
import { applyCors } from '../../lib/cors';

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
 * A limit per address and one per account, as on /api/r2/presign-upload —
 * this is the same act on the provider most of this account's files go to.
 *
 * The two actions are counted apart because they are not the same shape of
 * work: signing authorizes bytes that count against the quota, while deleting
 * gives bytes back and is the thing a person does in a run of ten. Both of
 * them reach outside this deployment, which is what the address limit in
 * front of the token check is really protecting.
 */
const byAddress = new RateLimiter(CLOUDINARY_IP_LIMIT);
const bySigningUser = new RateLimiter(CLOUDINARY_SIGN_LIMIT);
const byDeletingUser = new RateLimiter(CLOUDINARY_DELETE_LIMIT);

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
  // A ternary, not `??`: the browser sends '' — not undefined — when it cannot
  // work out a type, and '' is a string, so `??` never reached the filename.
  // A holiday.jpg picked up from a drive that reports no MIME type was being
  // signed for the raw endpoint.
  const isImage = contentType
    ? contentType.startsWith('image/')
    : /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(fileName);

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
  /* Before anything else: a preflight from the native shell carries no
     Authorization header, and everything below expects one. */
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  const ip = clientIp(req.headers, req.socket?.remoteAddress);
  if (!byAddress.allow(ip)) {
    tooManyRequests(
      res,
      byAddress.retryAfterSeconds(ip),
      'Too many requests. Try again in a minute.'
    );
    return;
  }

  try {
    const userId = await authenticateUser(req);

    const action = Array.isArray(req.query.action) ? req.query.action[0] : req.query.action;
    if (action === 'sign') {
      if (!bySigningUser.allow(userId)) {
        tooManyRequests(
          res,
          bySigningUser.retryAfterSeconds(userId),
          'Too many upload requests. Try again in a minute.'
        );
        return;
      }
      await signUpload(req, res, userId);
      return;
    }
    if (action !== 'delete') {
      res.status(404).json({ message: `Unknown action "${action ?? ''}"` });
      return;
    }

    // After the action is known, so an unknown segment cannot eat into the limit
    // of the one it was misspelled from.
    if (!byDeletingUser.allow(userId)) {
      tooManyRequests(
        res,
        byDeletingUser.retryAfterSeconds(userId),
        'Too many deletions. Try again in a minute.'
      );
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

    // Whitelisted, not taken as given: this value is interpolated into the
    // path Cloudinary is called on, and an unrecognised one would also skew
    // the not-found fallback below.
    const RESOURCE_TYPES = ['image', 'raw', 'video'];
    if (resourceType && !RESOURCE_TYPES.includes(resourceType)) {
      res.status(400).json({ message: `Unsupported resourceType "${resourceType}"` });
      return;
    }

    const options = { resource_type: resourceType || 'image' };

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
