import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Обработка preflight запросов
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Только POST запросы
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    // Динамический импорт Cloudinary
    const cloudinary = (await import('cloudinary')).v2;

    // Инициализация Cloudinary
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
      api_key: process.env.CLOUDINARY_API_KEY || '',
      api_secret: process.env.CLOUDINARY_API_SECRET || '',
    });

    const { publicId } = req.body as { publicId?: string };

    if (!publicId) {
      res.status(400).json({ error: 'publicId is required' });
      return;
    }

    // Удаление файла из Cloudinary
    const result = await cloudinary.uploader.destroy(publicId);

    if (result.result === 'ok') {
      res.status(200).json({ success: true });
      return;
    } else if (result.result === 'not found') {
      res.status(200).json({
        success: true,
        message: 'File not found (may already be deleted)',
      });
      return;
    } else {
      res.status(500).json({
        error: `Failed to delete file: ${result.result}`,
      });
      return;
    }
  } catch (error) {
    console.error('Error deleting file from Cloudinary:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to delete file',
    });
    return;
  }
}
