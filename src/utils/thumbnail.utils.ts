/**
 * Utility to generate thumbnail URLs for different storage providers
 */

/**
 * Generates a thumbnail URL based on the storage type and original URL
 * @param url The original download URL
 * @param storageType The storage provider type
 * @param width Desired width (default 200)
 * @param height Desired height (default 200)
 */
export const getThumbnailUrl = (
  url: string,
  storageType: string,
  width: number = 200,
  height: number = 200
): string => {
  if (!url) return '';

  switch (storageType) {
    case 'cloudinary':
      // Cloudinary transformations: /upload/v123/path -> /upload/w_200,h_200,c_fill,g_auto,q_auto,f_auto/v123/path
      if (url.includes('/upload/')) {
        return url.replace(
          '/upload/',
          `/upload/w_${width},h_${height},c_fill,g_auto,q_auto,f_auto/`
        );
      }
      return url;

    case 'supabase_storage':
      // Supabase has built-in transformation API if the bucket is configured for it
      // For now, since we use signed URLs, we return the original or add transform params if supported
      // Note: Transformations on signed URLs might require specific Supabase setup
      return url;

    case 'googledrive':
      // Google Drive thumbnails can often be accessed via a specific URL pattern,
      // but webViewLink usually doesn't support direct resizing via URL params easily without API
      return url;

    default:
      return url;
  }
};
