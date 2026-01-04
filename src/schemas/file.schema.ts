import { z } from 'zod';

const sanitizeFileName = (name: string): string => {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
};

const validateFileName = (name: string): boolean => {
  const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'];
  const upperName = name.toUpperCase().split('.')[0];
  if (reservedNames.includes(upperName)) {
    return false;
  }
  if (name.endsWith('.') || name.endsWith(' ')) {
    return false;
  }
  return true;
};

export const FolderSchema = z.object({
  id: z.string().uuid().optional(),
  name: z
    .string()
    .min(1, 'Folder name is required')
    .max(255, 'Folder name must be less than 255 characters')
    .refine(
      (name) => {
        const sanitized = sanitizeFileName(name);
        return sanitized.length > 0 && validateFileName(sanitized);
      },
      { message: 'Folder name contains invalid characters' }
    ),
  parent_id: z.string().uuid().nullable().optional(),
  user_id: z.string().optional(),
  created_at: z.string().optional(),
});

export const FileMetadataSchema = z.object({
  id: z.string().uuid().optional(),
  name: z
    .string()
    .min(1, 'File name is required')
    .max(255, 'File name must be less than 255 characters')
    .refine(
      (name) => {
        const sanitized = sanitizeFileName(name);
        return sanitized.length > 0 && validateFileName(sanitized);
      },
      { message: 'File name contains invalid characters' }
    ),
  size: z.number().positive(),
  type: z.string(),
  download_url: z.string(), // Removed .url() validation to prevent issues with complex signed URLs
  storage_path: z.string(),
  storage_type: z.enum(['cloudinary', 'firebase', 'googledrive', 'r2', 'supabase_storage']),
  folder_id: z.string().uuid().nullable().optional(),
  user_id: z.string().optional(),
  created_at: z.string().optional(),
});

export const validateAndSanitizeName = (name: string): string => {
  const sanitized = sanitizeFileName(name);
  if (!validateFileName(sanitized) || sanitized.length === 0) {
    throw new Error('Invalid file or folder name');
  }
  return sanitized;
};

export type Folder = z.infer<typeof FolderSchema>;
export type FileMetadata = z.infer<typeof FileMetadataSchema>;
