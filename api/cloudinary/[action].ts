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

/** Cloudinary stores PDFs as `raw`; everything else can be detected. */
function resourceTypeFor(fileName: string, contentType?: string): 'raw' | 'auto' {
  const isPdf = contentType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');
  return isPdf ? 'raw' : 'auto';
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
    res.status(500).json({ message: 'Cloudinary is not configured on the server' });
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
    res.status(405).json({ error: 'Method not allowed' });
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
      res.status(404).json({ error: `Unknown action "${action ?? ''}"` });
      return;
    }

    const cloudinary = (await import('cloudinary')).v2;
    configureCloudinary(cloudinary);

    const { publicId, resourceType } = req.body as { publicId?: string; resourceType?: string };

    if (!publicId) {
      res.status(400).json({ error: 'publicId is required' });
      return;
    }

    if (!(await ownsAsset(userId, publicId))) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // Determine options based on passed resourceType or default fallback
    // If resourceType is explicit (e.g. 'raw' for PDF), use it.
    // Otherwise default to 'image'.
    const options = resourceType ? { resource_type: resourceType } : { resource_type: 'image' };

    let result = await cloudinary.uploader.destroy(publicId, options);

    // Robust Fallback Logic:
    // If we tried 'image' (default) and got 'not found', it might be a 'raw' file or 'video'
    // that we didn't know about. Try finding it as 'raw' just in case.
    if (!resourceType && result.result === 'not found') {
      result = await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
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
        error: `Failed to delete file from Cloudinary: ${result.result}`,
        details: result,
      });
      return;
    }
  } catch (error) {
    console.error('Error deleting file from Cloudinary:', error);
    // Return the actual error message to help debugging
    res.status(error instanceof AuthError ? 401 : 500).json({
      error: error instanceof Error ? error.message : 'Unknown server error during deletion',
    });
    return;
  }
}
