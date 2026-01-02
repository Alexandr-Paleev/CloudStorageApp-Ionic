-- Create folders table
CREATE TABLE IF NOT EXISTS public.folders (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id UUID REFERENCES public.folders(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create files table
CREATE TABLE IF NOT EXISTS public.files (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    size BIGINT NOT NULL,
    type TEXT NOT NULL,
    download_url TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    storage_type TEXT NOT NULL,
    folder_id UUID REFERENCES public.folders(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

-- Policies for folders
CREATE POLICY "Users can manage their own folders" ON public.folders
    FOR ALL USING (auth.uid() = user_id);

-- Policies for files
CREATE POLICY "Users can manage their own files" ON public.files
    FOR ALL USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_folders_user_id ON public.folders(user_id);
CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON public.folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_files_user_id ON public.files(user_id);
CREATE INDEX IF NOT EXISTS idx_files_folder_id ON public.files(folder_id);
