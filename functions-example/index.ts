// Example Firebase Function for deleting files from Cloudinary
// Copy this file to functions/src/index.ts after initializing Firebase Functions

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { v2 as cloudinary } from 'cloudinary';

admin.initializeApp();

// Configure Cloudinary from Firebase Functions environment variables
cloudinary.config({
  cloud_name: functions.config().cloudinary.cloud_name,
  api_key: functions.config().cloudinary.api_key,
  api_secret: functions.config().cloudinary.api_secret,
});

/**
 * Firebase Function for deleting files from Cloudinary
 *
 * Usage:
 * 1. Set configuration: firebase functions:config:set cloudinary.cloud_name="..." cloudinary.api_key="..." cloudinary.api_secret="..."
 * 2. Deploy: firebase deploy --only functions:deleteCloudinaryFile
 * 3. Add URL to .env: VITE_CLOUDINARY_DELETE_API_URL=https://us-central1-your-project.cloudfunctions.net/deleteCloudinaryFile
 */
export const deleteCloudinaryFile = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { publicId } = data;

  if (!publicId) {
    throw new functions.https.HttpsError('invalid-argument', 'publicId is required');
  }

  try {
    const result = await cloudinary.uploader.destroy(publicId);

    if (result.result === 'ok') {
      return { success: true, message: 'File deleted successfully' };
    } else if (result.result === 'not found') {
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









