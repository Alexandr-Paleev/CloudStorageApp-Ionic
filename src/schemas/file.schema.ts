import { z } from 'zod';
import { isSafeHttpUrl } from '@cloud-storage/core/safe-url';
import { MAX_NAME_LENGTH, STORAGE_TYPES } from '@cloud-storage/core/file-rules';

const sanitizeFileName = (name: string): string => {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
};

const validateFileName = (name: string): boolean => {
  const reservedNames = [
    'CON',
    'PRN',
    'AUX',
    'NUL',
    'COM1',
    'COM2',
    'COM3',
    'COM4',
    'COM5',
    'COM6',
    'COM7',
    'COM8',
    'COM9',
    'LPT1',
    'LPT2',
    'LPT3',
    'LPT4',
    'LPT5',
    'LPT6',
    'LPT7',
    'LPT8',
    'LPT9',
  ];
  const upperName = name.toUpperCase().split('.')[0] ?? '';
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
    .max(MAX_NAME_LENGTH, `A folder name can be at most ${MAX_NAME_LENGTH} characters`)
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
    .max(MAX_NAME_LENGTH, `A file name can be at most ${MAX_NAME_LENGTH} characters`)
    .refine(
      (name) => {
        const sanitized = sanitizeFileName(name);
        return sanitized.length > 0 && validateFileName(sanitized);
      },
      { message: 'File name contains invalid characters' }
    ),
  /* Zero is a size: an empty file is still a file, and `positive()` refused it
     only after its upload, with the schema's own JSON as the message. The
     database holds the same line (migrations/018). */
  size: z.number().int().nonnegative(),
  type: z.string(),
  /* A scheme allowlist rather than `.url()`. The full check was removed
     because it rejected the long signed URLs R2 and Supabase Storage hand back;
     this asks only the question that matters — whether the value can execute
     when something puts it in an href — and every signed URL passes it. */
  download_url: z
    .string()
    .refine(isSafeHttpUrl, { message: 'download_url must be an http(s) URL' }),
  storage_path: z.string(),
  // The providers registered in ProviderManager, and the ones migrations/018
  // allows: a value no provider implements makes every read of such a row
  // throw "Storage provider not found".
  storage_type: z.enum(STORAGE_TYPES),
  folder_id: z.string().uuid().nullable().optional(),
  user_id: z.string().optional(),
  created_at: z.string().optional(),
});

/** A name the rules refuse: what was typed, not something that broke. Named,
 *  so the error metric can leave it out (src/query-client.ts). */
export class NameRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NameRuleError';
  }
}

export const validateAndSanitizeName = (name: string): string => {
  const sanitized = sanitizeFileName(name);
  if (!validateFileName(sanitized) || sanitized.length === 0) {
    throw new NameRuleError('Invalid file or folder name');
  }
  /* The schemas above say the same, but only when a row is written: a rename
     passed a name of any length to the database. */
  if (sanitized.length > MAX_NAME_LENGTH) {
    throw new NameRuleError(`A name can be at most ${MAX_NAME_LENGTH} characters`);
  }
  return sanitized;
};

export type Folder = z.infer<typeof FolderSchema>;
export type FileMetadata = z.infer<typeof FileMetadataSchema>;
