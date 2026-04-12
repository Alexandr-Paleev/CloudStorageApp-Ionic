import { IStorageProvider } from './storage.provider';
import { CloudinaryProvider } from './impl/CloudinaryProvider';
import { SupabaseStorageProvider } from './impl/SupabaseStorageProvider';
import { GoogleDriveProvider } from './impl/GoogleDriveProvider';
import { R2Provider } from './impl/R2Provider';
import { DropboxProvider } from './impl/DropboxProvider';

class ProviderManager {
  private providers: Map<string, IStorageProvider> = new Map();

  constructor() {
    this.register(new CloudinaryProvider());
    this.register(new SupabaseStorageProvider());
    this.register(new GoogleDriveProvider());
    this.register(new R2Provider());
    this.register(new DropboxProvider());
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
      preferredProvider?: string;
      allowedProviders?: string[];
    }
  ): Promise<IStorageProvider> {
    // If user explicitly chose a provider and it's allowed
    if (options.preferredProvider && options.allowedProviders) {
      if (!options.allowedProviders.includes(options.preferredProvider)) {
        throw new Error(`Provider "${options.preferredProvider}" is not available on your plan.`);
      }
      const preferred = this.providers.get(options.preferredProvider);
      if (!preferred || !preferred.isConfigured()) {
        throw new Error(
          `Provider "${options.preferredProvider}" is not configured. Check your settings.`
        );
      }
      if (preferred.isConnected) {
        const connected = await preferred.isConnected();
        if (!connected) {
          throw new Error(
            `Provider "${options.preferredProvider}" is not connected. Please authorize it first.`
          );
        }
      }
      return preferred;
    }

    const driveProvider = this.getProvider('googledrive') as GoogleDriveProvider;
    const isDriveConnected = await driveProvider.isConnected();
    const canUploadLocal = await options.canUploadToLocal(file.size);
    const shouldUseGoogleDrive = options.useGoogleDrive || (!canUploadLocal && isDriveConnected);

    if (shouldUseGoogleDrive && isDriveConnected) {
      return driveProvider;
    }

    if (!canUploadLocal && !isDriveConnected) {
      throw new Error(
        'Storage limit exceeded. Connect Google Drive or upgrade to Pro for more storage.'
      );
    }

    const isImage = file.type.startsWith('image/');
    const cloudinaryProvider = this.getProvider('cloudinary');
    if (isImage && cloudinaryProvider.isConfigured()) {
      return cloudinaryProvider;
    }

    const r2Provider = this.getProvider('r2');
    if (r2Provider.isConfigured()) {
      return r2Provider;
    }

    return this.getProvider('supabase_storage');
  }
}

export const providerManager = new ProviderManager();
