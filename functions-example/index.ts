// Пример Firebase Function для удаления файлов из Cloudinary
// Скопируйте этот файл в functions/src/index.ts после инициализации Firebase Functions

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { v2 as cloudinary } from 'cloudinary';

admin.initializeApp();

// Настройка Cloudinary из переменных окружения Firebase Functions
cloudinary.config({
  cloud_name: functions.config().cloudinary.cloud_name,
  api_key: functions.config().cloudinary.api_key,
  api_secret: functions.config().cloudinary.api_secret,
});

/**
 * Firebase Function для удаления файлов из Cloudinary
 *
 * Использование:
 * 1. Установите конфигурацию: firebase functions:config:set cloudinary.cloud_name="..." cloudinary.api_key="..." cloudinary.api_secret="..."
 * 2. Задеплойте: firebase deploy --only functions:deleteCloudinaryFile
 * 3. Добавьте URL в .env: VITE_CLOUDINARY_DELETE_API_URL=https://us-central1-your-project.cloudfunctions.net/deleteCloudinaryFile
 */
export const deleteCloudinaryFile = functions.https.onCall(async (data, context) => {
  // Проверка аутентификации
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { publicId } = data;

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
      return { success: true, message: 'File not found (may already be deleted)' };
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









