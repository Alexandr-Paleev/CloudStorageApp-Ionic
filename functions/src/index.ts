import * as functions from 'firebase-functions/v1';
import { initializeApp } from 'firebase-admin/app';
import { v2 as cloudinary } from 'cloudinary';

initializeApp();

// Configure Cloudinary from environment variables
// Set via Firebase Console > Functions > Configuration
// or via command: firebase functions:secrets:set CLOUDINARY_API_SECRET
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
  api_key: process.env.CLOUDINARY_API_KEY || '',
  api_secret: process.env.CLOUDINARY_API_SECRET || '',
});

/**
 * Firebase Function for deleting files from Cloudinary
 */
export const deleteCloudinaryFile = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { publicId } = data as { publicId: string };

  if (!publicId) {
    throw new functions.https.HttpsError('invalid-argument', 'publicId is required');
  }

  try {
    const result = await cloudinary.uploader.destroy(publicId);

    if (result.result === 'ok') {
      return { success: true, message: 'File deleted successfully' };
    } else if (result.result === 'not found') {
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
