import { supabase } from '../supabase/supabase.config';
import { FileMetadata, Folder, FileMetadataSchema, FolderSchema } from '../schemas/file.schema';
import * as Sentry from '../observability/sentry';
import { isQuotaRejection } from '../utils/quota.utils';
import {
  DEFAULT_DIRECTION,
  DEFAULT_SORT,
  DOCUMENT_PREFIXES,
  IMAGE_PREFIX,
  escapeLike,
  scopedToFolder,
  type FileQuery,
} from '../utils/file-query';

const supabaseService = {
  /**
   * The files one screen of the dashboard shows.
   *
   * Searching, sorting and filtering all happen here rather than in the
   * browser, because the list is paginated: a filter applied to the fifteen
   * rows already loaded would find a file only if it was already visible.
   */
  async getFiles(userId: string, options: FileQuery = {}): Promise<FileMetadata[]> {
    const {
      folderId = null,
      page,
      pageSize,
      search,
      sort = DEFAULT_SORT,
      direction = DEFAULT_DIRECTION,
      group = 'all',
    } = options;

    let query = supabase.from('files').select('*').eq('user_id', userId);

    // A search reaches across folders — see scopedToFolder() for why.
    if (scopedToFolder(options)) {
      query = folderId ? query.eq('folder_id', folderId) : query.is('folder_id', null);
    }

    if (search && search.trim()) {
      query = query.ilike('name', `%${escapeLike(search.trim())}%`);
    }

    if (group === 'images') {
      query = query.ilike('type', `${IMAGE_PREFIX}%`);
    } else if (group === 'documents') {
      query = query.or(DOCUMENT_PREFIXES.map((prefix) => `type.ilike.${prefix}%`).join(','));
    } else if (group === 'other') {
      // Everything the other two groups would have claimed, refused one prefix
      // at a time: PostgREST has no "none of these" operator.
      for (const prefix of [IMAGE_PREFIX, ...DOCUMENT_PREFIXES]) {
        query = query.not('type', 'ilike', `${prefix}%`);
      }
    }

    // Apply pagination if provided
    if (page !== undefined && pageSize !== undefined) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);
    }

    const { data, error } = await query.order(sort, { ascending: direction === 'asc' });

    if (error) {
      Sentry.captureException(error, { tags: { context: 'supabase.getFiles' } });
      throw error;
    }

    return (data || []) as FileMetadata[];
  },

  /**
   * Bytes the account has stored with the backends this app pays for.
   *
   * Google Drive and Dropbox are not counted: those files live in the user's
   * own cloud. The figure comes from profiles.bytes_used, a counter kept by
   * the trigger in migrations/007 — the same one that enforces the limit.
   */
  async getTotalStorageUsed(userId: string): Promise<number> {
    // One row, not every row. This used to page through the whole files table
    // on each call — and it is called before every upload, alongside the same
    // walk happening again inside the API. profiles.bytes_used is kept by the
    // trigger from migrations/007, which is also what enforces the limit.
    const { data, error } = await supabase
      .from('profiles')
      .select('bytes_used')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      Sentry.captureException(error, { tags: { context: 'supabase.getTotalStorageUsed' } });

      // Deploy order: this column arrives with migrations/007. lib/quota.ts
      // says the same thing on the server side; without it the symptom is a
      // meter stuck at 0 B and every upload failing, which points nowhere.
      if (/bytes_used/.test(error.message ?? '')) {
        throw new Error(
          'profiles.bytes_used is missing — apply migrations/007_enforce_storage_quota.sql'
        );
      }

      throw error;
    }

    return (data as { bytes_used: number } | null)?.bytes_used ?? 0;
  },

  /**
   * Get all folders for a user in a specific folder
   */
  async getFolders(userId: string, parentId: string | null = null): Promise<Folder[]> {
    let query = supabase.from('folders').select('*').eq('user_id', userId);

    if (parentId) {
      query = query.eq('parent_id', parentId);
    } else {
      query = query.is('parent_id', null);
    }

    const { data, error } = await query.order('name');

    if (error) {
      Sentry.captureException(error, { tags: { context: 'supabase.getFolders' } });
      throw error;
    }

    return (data || []) as Folder[];
  },

  /**
   * Get single folder metadata
   */
  async getFolder(folderId: string, userId: string): Promise<Folder | null> {
    const { data, error } = await supabase
      .from('folders')
      .select('*')
      .eq('id', folderId)
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      Sentry.captureException(error, { tags: { context: 'supabase.getFolder' } });
      throw error;
    }

    return data as Folder;
  },

  /**
   * Create a new folder
   */
  async createFolder(folder: Omit<Folder, 'id' | 'created_at'>): Promise<Folder> {
    const validatedFolder = FolderSchema.omit({ id: true, created_at: true }).parse(folder);

    const { data, error } = await supabase
      .from('folders')
      .insert(validatedFolder)
      .select()
      .single();

    if (error) {
      Sentry.captureException(error, { tags: { context: 'supabase.createFolder' } });
      throw error;
    }

    return data as Folder;
  },

  /**
   * Save file metadata
   */
  async saveFileMetadata(metadata: Omit<FileMetadata, 'id' | 'created_at'>): Promise<FileMetadata> {
    const validatedMetadata = FileMetadataSchema.omit({ id: true, created_at: true }).parse(
      metadata
    );

    const { data, error } = await supabase
      .from('files')
      .insert(validatedMetadata)
      .select()
      .single();

    if (error) {
      // An account that ran out of space is not a fault to report — the caller
      // turns this into a sentence the user can act on. Reporting it here as
      // well is what made the skip in storage.service.uploadFile ineffective.
      if (!isQuotaRejection(error)) {
        Sentry.captureException(error, { tags: { context: 'supabase.saveFileMetadata' } });
      }
      throw error;
    }

    return data as FileMetadata;
  },

  /**
   * Delete folder and its contents (recursive) with user ownership check
   * Note: This should ideally be a database function for performance
   */
  async deleteFolder(folderId: string, userId: string): Promise<void> {
    const { data: folder, error: folderError } = await supabase
      .from('folders')
      .select('id, user_id')
      .eq('id', folderId)
      .eq('user_id', userId)
      .single();

    if (folderError || !folder) {
      throw new Error('Folder not found or access denied');
    }

    const { data: subfolders } = await supabase
      .from('folders')
      .select('id')
      .eq('parent_id', folderId)
      .eq('user_id', userId);

    if (subfolders) {
      for (const sub of subfolders) {
        await this.deleteFolder(sub.id, userId);
      }
    }

    await supabase.from('files').delete().eq('folder_id', folderId).eq('user_id', userId);

    const { error } = await supabase
      .from('folders')
      .delete()
      .eq('id', folderId)
      .eq('user_id', userId);

    if (error) {
      Sentry.captureException(error, { tags: { context: 'supabase.deleteFolder' } });
      throw error;
    }
  },

  /**
   * Get single file metadata with user ownership check
   */
  async getFileMetadata(fileId: string, userId: string): Promise<FileMetadata | null> {
    const { data, error } = await supabase
      .from('files')
      .select('*')
      .eq('id', fileId)
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      Sentry.captureException(error, { tags: { context: 'supabase.getFileMetadata' } });
      throw error;
    }

    return data as FileMetadata | null;
  },

  /**
   * Delete file metadata with user ownership check
   */
  async deleteFileMetadata(fileId: string, userId: string): Promise<void> {
    const { data, error } = await supabase
      .from('files')
      .delete()
      .eq('id', fileId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      Sentry.captureException(error, { tags: { context: 'supabase.deleteFileMetadata' } });
      throw error;
    }

    if (!data) {
      throw new Error('File not found or access denied');
    }
  },

  /**
   * Update file metadata (rename, move) with user ownership check
   */
  async updateFileMetadata(
    fileId: string,
    userId: string,
    updates: Partial<FileMetadata>
  ): Promise<void> {
    const { data, error } = await supabase
      .from('files')
      .update(updates)
      .eq('id', fileId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      Sentry.captureException(error, { tags: { context: 'supabase.updateFileMetadata' } });
      throw error;
    }

    if (!data) {
      throw new Error('File not found or access denied');
    }
  },
};

export default supabaseService;
