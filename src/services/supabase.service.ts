import { supabase } from '../supabase/supabase.config';
import { FileMetadata, Folder, FileMetadataSchema, FolderSchema } from '../schemas/file.schema';

const supabaseService = {
    /**
     * Get all files for a user in a specific folder
     */
    async getFiles(
        userId: string,
        folderId: string | null = null,
        page?: number,
        pageSize?: number
    ): Promise<FileMetadata[]> {
        let query = supabase
            .from('files')
            .select('*')
            .eq('user_id', userId);

        if (folderId) {
            query = query.eq('folder_id', folderId);
        } else {
            query = query.is('folder_id', null);
        }

        // Apply pagination if provided
        if (page !== undefined && pageSize !== undefined) {
            const from = page * pageSize;
            const to = from + pageSize - 1;
            query = query.range(from, to);
        }

        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) {
            console.error('Supabase getFiles error:', error);
            throw error;
        }

        return (data || []) as FileMetadata[];
    },

    /**
     * Get all folders for a user in a specific folder
     */
    async getFolders(userId: string, parentId: string | null = null): Promise<Folder[]> {
        let query = supabase
            .from('folders')
            .select('*')
            .eq('user_id', userId);

        if (parentId) {
            query = query.eq('parent_id', parentId);
        } else {
            query = query.is('parent_id', null);
        }

        const { data, error } = await query.order('name');

        if (error) {
            console.error('Supabase getFolders error:', error);
            throw error;
        }

        return (data || []) as Folder[];
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
            console.error('Supabase createFolder error:', error);
            throw error;
        }

        return data as Folder;
    },

    /**
     * Save file metadata
     */
    async saveFileMetadata(metadata: Omit<FileMetadata, 'id' | 'created_at'>): Promise<FileMetadata> {
        const validatedMetadata = FileMetadataSchema.omit({ id: true, created_at: true }).parse(metadata);

        const { data, error } = await supabase
            .from('files')
            .insert(validatedMetadata)
            .select()
            .single();

        if (error) {
            console.error('Supabase saveFileMetadata error:', error);
            throw error;
        }

        return data as FileMetadata;
    },

    /**
     * Delete folder and its contents (recursive)
     * Note: This should idealy be a database function for performance
     */
    async deleteFolder(folderId: string): Promise<void> {
        // 1. Get all subfolders
        const { data: subfolders } = await supabase
            .from('folders')
            .select('id')
            .eq('parent_id', folderId);

        // 2. Recursively delete subfolders
        if (subfolders) {
            for (const sub of subfolders) {
                await this.deleteFolder(sub.id);
            }
        }

        // 3. Delete files in this folder (metadata only here, actual storage deletion handled separately)
        await supabase.from('files').delete().eq('folder_id', folderId);

        // 4. Delete the folder itself
        const { error } = await supabase.from('folders').delete().eq('id', folderId);

        if (error) {
            console.error('Supabase deleteFolder error:', error);
            throw error;
        }
    },

    /**
     * Delete file metadata
     */
    async deleteFileMetadata(fileId: string): Promise<void> {
        const { error } = await supabase.from('files').delete().eq('id', fileId);

        if (error) {
            console.error('Supabase deleteFileMetadata error:', error);
            throw error;
        }
    },

    /**
     * Update file metadata (rename, move)
     */
    async updateFileMetadata(fileId: string, updates: Partial<FileMetadata>): Promise<void> {
        const { error } = await supabase
            .from('files')
            .update(updates)
            .eq('id', fileId);

        if (error) {
            console.error('Supabase updateFileMetadata error:', error);
            throw error;
        }
    },
};

export default supabaseService;
