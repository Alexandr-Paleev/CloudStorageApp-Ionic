import { IStorageProvider } from './storage.provider';
import { CloudinaryProvider } from './impl/CloudinaryProvider';
import { SupabaseStorageProvider } from './impl/SupabaseStorageProvider';
import { GoogleDriveProvider } from './impl/GoogleDriveProvider';
import { R2Provider } from './impl/R2Provider';
import { DropboxProvider } from './impl/DropboxProvider';

/**
 * Providers we host and pay for — uploads there count against the plan quota.
 * Google Drive and Dropbox live in the user's own cloud account.
 */
const LOCAL_PROVIDERS = ['cloudinary', 'r2', 'supabase_storage'];

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
      // Picking a provider by hand must not skip the quota the auto path enforces
      if (
        LOCAL_PROVIDERS.includes(preferred.name) &&
        !(await options.canUploadToLocal(file.size))
      ) {
        throw new Error(
          'Storage limit exceeded. Upgrade to Pro, or upload to Google Drive / Dropbox instead.'
        );
      }
      return preferred;
    }

    const driveProvider = this.getProvider('googledrive') as GoogleDriveProvider;
    const isDriveConnected = await driveProvider.isConnected();

    // Asked for by name, and it costs the plan nothing — so answer it before
    // reading the quota at all. That read can fail (a profiles blip, or the
    // column from migrations/007 not being there yet), and a Drive upload
    // failing because the *local* quota could not be read is a fault in the
    // one path that exists for when local storage is unusable.
    if (options.useGoogleDrive && isDriveConnected) {
      return driveProvider;
    }

    const canUploadLocal = await options.canUploadToLocal(file.size);

    if (!canUploadLocal && isDriveConnected) {
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
