/**
 * Analytics event type definitions for GA4 tracking
 * All events follow Google Analytics 4 naming conventions
 */

/**
 * Event fired when a file is successfully uploaded
 */
export interface UploadFileEvent {
  /** MIME type of the uploaded file (e.g., 'image/png', 'application/pdf') */
  file_type: string;
  /** File size in bytes */
  file_size: number;
  /** Storage provider used (e.g., 'cloudinary', 'r2', 'supabase', 'google_drive') */
  storage_provider: string;
  /** ID of the folder the file was uploaded to, if any */
  folder_id?: string;
}

/**
 * Event fired when a file is deleted
 */
export interface DeleteFileEvent {
  /** Unique identifier of the deleted file */
  file_id: string;
  /** MIME type of the deleted file */
  file_type: string;
  /** File size in bytes */
  file_size: number;
}

/**
 * Event fired when a file is shared
 */
export interface ShareFileEvent {
  /** Unique identifier of the shared file */
  file_id: string;
  /** Method used to share the file */
  share_method: 'link' | 'email' | 'native';
}

/**
 * Event fired when an API error occurs (tracked via TanStack Query)
 */
export interface ApiErrorEvent {
  /** Error message */
  error_message: string;
  /** API endpoint that failed, if known */
  endpoint?: string;
  /** TanStack Query key that failed */
  query_key?: string;
}

/**
 * Event fired when a folder is created
 */
export interface CreateFolderEvent {
  /** ID of the parent folder, if any */
  parent_id?: string;
}

/**
 * Event fired when a folder is deleted
 */
export interface DeleteFolderEvent {
  /** Unique identifier of the deleted folder */
  folder_id: string;
}

/**
 * Event fired when a file is renamed
 */
export interface RenameFileEvent {
  /** Unique identifier of the renamed file */
  file_id: string;
}

/**
 * Union type of all analytics events
 */
export type AnalyticsEvent =
  | { name: 'upload_file'; params: UploadFileEvent }
  | { name: 'delete_file'; params: DeleteFileEvent }
  | { name: 'share_file'; params: ShareFileEvent }
  | { name: 'api_error'; params: ApiErrorEvent }
  | { name: 'create_folder'; params: CreateFolderEvent }
  | { name: 'delete_folder'; params: DeleteFolderEvent }
  | { name: 'rename_file'; params: RenameFileEvent };

/**
 * GA4 page view parameters
 */
export interface PageViewParams {
  /** Page path (e.g., '/dashboard', '/upload') */
  page_path: string;
  /** Page title */
  page_title?: string;
}
