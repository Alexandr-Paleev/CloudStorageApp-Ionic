import { supabase } from './auth';
import { MAX_NAME_LENGTH, type ServerRecorded } from '../../core/src/file-rules';

/**
 * Writing the row of a file a server function has weighed.
 *
 * The rows of Cloudinary and R2 files used to be written by the browser, with
 * a size the browser named, and the quota trigger from migration 007 counted
 * that number. Migration 020 takes the insert away from the browser for these
 * two providers: the function that confirms an upload asks the provider how
 * many bytes it holds and writes the row here, with the service role. See
 * docs/decisions/0017-the-server-weighs-an-upload.md.
 */

/** What the browser still says about a file: what it is called, what kind of
 *  file it is and where it goes. Never how large it is. */
export type UploadDescription = {
  name: string;
  type: string;
  folderId: string | null;
};

export type StoredFileRow = {
  id: string;
  name: string;
  size: number;
  type: string;
  download_url: string;
  storage_path: string;
  storage_type: ServerRecorded;
  folder_id: string | null;
  user_id: string;
  created_at: string;
};

/** The quota trigger refused the row: the account has no room for these bytes. */
export class QuotaExceeded extends Error {}

/** The row named a folder that is not the account's: 018's foreign key has the
 *  owner in it, so a folder of another account is no folder at all. */
export class UnknownFolder extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The description in a confirm request's body, or what is wrong with it.
 *
 * The database checks the same and more (018), but its refusal would be a 500
 * here; a body that cannot be a row is the caller's mistake, and a 400. The
 * browser has already put the name through its own rules
 * (`validateAndSanitizeName`), which are about what a person meant to type,
 * not about whose bytes these are, so they are not repeated.
 */
export function readUploadDescription(
  body: unknown
): { description: UploadDescription } | { problem: string } {
  const { name, type, folderId } = (body ?? {}) as Record<string, unknown>;

  if (typeof name !== 'string' || name.trim().length === 0) {
    return { problem: 'name is required' };
  }
  if (name.length > MAX_NAME_LENGTH) {
    return { problem: `A name can be at most ${MAX_NAME_LENGTH} characters` };
  }
  if (type !== undefined && (typeof type !== 'string' || type.length > 255)) {
    return { problem: 'type must be a MIME type' };
  }
  if (
    folderId !== undefined &&
    folderId !== null &&
    !(typeof folderId === 'string' && UUID.test(folderId))
  ) {
    return { problem: 'folderId must be a folder id or null' };
  }

  return {
    description: {
      name,
      type: (type as string | undefined) ?? '',
      folderId: (folderId as string | null | undefined) ?? null,
    },
  };
}

/**
 * Writes the row, with the size the provider reported.
 *
 * The quota is held by the same trigger as before, now counting a number no
 * caller chose; it answers `PT413` when the bytes do not fit, which becomes
 * `QuotaExceeded`. The caller deletes the stored object then, since nothing
 * else would come back for it.
 */
export async function recordUpload(upload: {
  userId: string;
  description: UploadDescription;
  size: number;
  downloadUrl: string;
  storagePath: string;
  storageType: ServerRecorded;
}): Promise<StoredFileRow> {
  const { data, error } = await supabase
    .from('files')
    .insert({
      name: upload.description.name,
      size: upload.size,
      type: upload.description.type,
      download_url: upload.downloadUrl,
      storage_path: upload.storagePath,
      storage_type: upload.storageType,
      folder_id: upload.description.folderId,
      user_id: upload.userId,
    })
    .select()
    .single();

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === 'PT413') throw new QuotaExceeded(error.message);
    // foreign_key_violation: the folder is gone, or never was this account's.
    if (code === '23503') throw new UnknownFolder('That folder does not exist');
    throw new Error(`Could not record the upload: ${error.message}`);
  }

  return data as StoredFileRow;
}
