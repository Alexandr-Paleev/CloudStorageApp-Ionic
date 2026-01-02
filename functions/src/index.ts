import * as functions from 'firebase-functions/v1';
import { initializeApp } from 'firebase-admin/app';
import { v2 as cloudinary } from 'cloudinary';

initializeApp();

// Настройка Cloudinary из переменных окружения
// Установите через Firebase Console > Functions > Configuration
// или через команду: firebase functions:secrets:set CLOUDINARY_API_SECRET
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
  api_key: process.env.CLOUDINARY_API_KEY || '',
  api_secret: process.env.CLOUDINARY_API_SECRET || '',
});

/**
 * Firebase Function для удаления файлов из Cloudinary
 */
export const deleteCloudinaryFile = functions.https.onCall(async (data, context) => {
  // Проверка аутентификации
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { publicId } = data as { publicId: string };

  if (!publicId) {
    throw new functions.https.HttpsError('invalid-argument', 'publicId is required');
  }

  try {
    // Удаление файла из Cloudinary
    const result = await cloudinary.uploader.destroy(publicId);

    if (result.result === 'ok') {
      return { success: true, message: 'File deleted successfully' };
    } else if (result.result === 'not found') {
      // Файл уже удален или не существует - это не ошибка
      return {
        success: true,
        message: 'File not found (may already be deleted)',
      };
    } else {
      throw new functions.https.HttpsError('internal', `Failed to delete file: ${result.result}`);
    }
  } catch (error) {
    console.error('Error deleting file from Cloudinary:', error);
    throw new functions.https.HttpsError(
      'internal',
      error instanceof Error ? error.message : 'Failed to delete file'
    );
  }
});
