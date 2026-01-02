import { z } from 'zod';

export const FolderSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, 'Folder name is required'),
  parent_id: z.string().uuid().nullable().optional(),
  user_id: z.string().optional(),
  created_at: z.string().optional(),
});

export const FileMetadataSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, 'File name is required'),
  size: z.number().positive(),
  type: z.string(),
  download_url: z.string().url(),
  storage_path: z.string(),
  storage_type: z.enum(['cloudinary', 'firebase', 'googledrive', 'r2', 'supabase_storage']),
  folder_id: z.string().uuid().nullable().optional(),
  user_id: z.string().optional(),
  created_at: z.string().optional(),
});

export type Folder = z.infer<typeof FolderSchema>;
export type FileMetadata = z.infer<typeof FileMetadataSchema>;
