import { IStorageProvider } from './storage.provider';
import { CloudinaryProvider } from './impl/CloudinaryProvider';
import { SupabaseStorageProvider } from './impl/SupabaseStorageProvider';
import { GoogleDriveProvider } from './impl/GoogleDriveProvider';
import { R2Provider } from './impl/R2Provider';

class ProviderManager {
    private providers: Map<string, IStorageProvider> = new Map();

    constructor() {
        this.register(new CloudinaryProvider());
        this.register(new SupabaseStorageProvider());
        this.register(new GoogleDriveProvider());
        this.register(new R2Provider());
    }

    register(provider: IStorageProvider) {
        this.providers.set(provider.name, provider);
    }

    getProvider(name: string): IStorageProvider {
        const provider = this.providers.get(name);
        if (!provider) {
            throw new Error(`Storage provider "${name}" not found`);
        }
        return provider;
    }

    /**
     * Logic to choose best provider for a specific file and user state
     */
    async selectProvider(
        file: File,
        _userId: string,
        options: {
            canUploadToLocal: (size: number) => Promise<boolean>;
            useGoogleDrive?: boolean;
        }
    ): Promise<IStorageProvider> {
        // 1. Special case for PDFs
        const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
        if (isPdf) {
            return this.getProvider('supabase_storage');
        }

        // 2. Check Google Drive fallback
        const driveProvider = this.getProvider('googledrive') as GoogleDriveProvider;
        const isDriveConnected = await driveProvider.isConnected();
        const canUploadLocal = await options.canUploadToLocal(file.size);
        const shouldUseGoogleDrive = options.useGoogleDrive || (!canUploadLocal && isDriveConnected);

        if (shouldUseGoogleDrive && isDriveConnected) {
            return driveProvider;
        }

        if (!canUploadLocal && !isDriveConnected) {
            throw new Error('Storage limit exceeded. Connect Google Drive to upload more files.');
        }

        // 3. Prefer R2 if configured
        const r2Provider = this.getProvider('r2');
        if (r2Provider.isConfigured()) {
            return r2Provider;
        }

        // 4. Default to Cloudinary
        const cloudinaryProvider = this.getProvider('cloudinary');
        if (cloudinaryProvider.isConfigured()) {
            return cloudinaryProvider;
        }

        throw new Error('No storage provider configured.');
    }
}

export const providerManager = new ProviderManager();
