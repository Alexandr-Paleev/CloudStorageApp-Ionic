/**
 * What a `files` or `folders` row may say, written once for the code.
 *
 * The browser asks these before it writes a row, and migrations/018 asks them
 * again in the database, where they cannot be talked past. SQL cannot import
 * this file, so `file-rules.test.ts` reads the migration and holds the two
 * copies together. A change here is a change there, in a new migration.
 */

/** Every provider a row may name: the five the app registers. */
export const STORAGE_TYPES = [
  'cloudinary',
  'r2',
  'supabase_storage',
  'googledrive',
  'dropbox',
] as const;

export type StorageType = (typeof STORAGE_TYPES)[number];

/**
 * Characters in the name of a file or a folder.
 *
 * Postgres counts characters; a JavaScript string's length counts UTF-16 code
 * units, which is never fewer. Measured with `.length`, the browser is the
 * stricter of the two, and nothing it lets through is refused by the database.
 */
export const MAX_NAME_LENGTH = 255;

/**
 * Providers whose rows only a server function writes (migration 020).
 *
 * The size of a file there is a number the quota is counted in, and a browser
 * that names it can name less than it stored. These two are weighed by the
 * function that confirms the upload, which asks the provider and writes the
 * row itself. Supabase Storage is not here: the database can see that bucket,
 * and 020 has it take the size from the object when the browser writes the
 * row. Google Drive and Dropbox count against nothing of ours.
 */
export const SERVER_RECORDED = ['cloudinary', 'r2'] as const;

export type ServerRecorded = (typeof SERVER_RECORDED)[number];

export function isServerRecorded(storageType: string): storageType is ServerRecorded {
  return (SERVER_RECORDED as readonly string[]).includes(storageType);
}
