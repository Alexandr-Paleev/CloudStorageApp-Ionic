import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateUser, AuthError, supabase } from '../../lib/auth';

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
    const cloudinary = (await import('cloudinary')).v2;

    // Server-side names only: a VITE_ prefixed fallback would be inlined into
    // the public client bundle by Vite.
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
      api_key: process.env.CLOUDINARY_API_KEY || '',
      api_secret: process.env.CLOUDINARY_API_SECRET || '',
    });

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
