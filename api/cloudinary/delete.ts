import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const cloudinary = (await import('cloudinary')).v2;

    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME || process.env.VITE_CLOUDINARY_CLOUD_NAME || '',
      api_key: process.env.CLOUDINARY_API_KEY || process.env.VITE_CLOUDINARY_API_KEY || '',
      api_secret: process.env.CLOUDINARY_API_SECRET || process.env.VITE_CLOUDINARY_API_SECRET || '',
    });

    const { publicId, resourceType } = req.body as { publicId?: string; resourceType?: string };

    if (!publicId) {
      res.status(400).json({ error: 'publicId is required' });
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
        message: result.result === 'not found' ? 'File not found (may already be deleted)' : 'Deleted successfully',
        details: result
      });
      return;
    } else {
      console.error(`[Cloudinary] Deletion failed:`, result);
      res.status(500).json({
        error: `Failed to delete file from Cloudinary: ${result.result}`,
        details: result
      });
      return;
    }
  } catch (error) {
    console.error('Error deleting file from Cloudinary:', error);
    // Return the actual error message to help debugging
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown server error during deletion',
    });
    return;
  }
}
