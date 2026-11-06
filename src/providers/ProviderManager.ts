import { IStorageProvider } from './storage.provider';
import { CloudinaryProvider } from './impl/CloudinaryProvider';
import { SupabaseStorageProvider } from './impl/SupabaseStorageProvider';
import { GoogleDriveProvider } from './impl/GoogleDriveProvider';
import { R2Provider } from './impl/R2Provider';
import { DropboxProvider } from './impl/DropboxProvider';
import { HOSTED_PROVIDERS, isHostedProvider } from '@cloud-storage/core/stored-path';
import { formatBytes, formatStorage } from '@cloud-storage/core/format';
import { FileTooLargeError, UPLOAD_LIMITS, fitsProvider } from './upload-limits';

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

  /** The providers this deployment has set up, which are the only ones a
   *  person can be offered: a plan does not make the others work. */
  configuredNames(): string[] {
    return [...this.providers.values()]
      .filter((provider) => provider.isConfigured())
      .map((provider) => provider.name);
  }

  /** The largest file a provider this deployment hosts takes, which is the
   *  largest the automatic choice can keep without Google Drive. */
  largestHostedUpload(): number {
    return Math.max(
      ...HOSTED_PROVIDERS.filter((name) => this.getProvider(name).isConfigured()).map(
        (name) => UPLOAD_LIMITS[name] ?? Infinity
      )
    );
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
      // Said before a byte travels, not by the provider after the last one.
      if (!fitsProvider(preferred.name, file.size)) {
        throw new FileTooLargeError(
          `Provider "${preferred.name}" takes files up to ${formatStorage(UPLOAD_LIMITS[preferred.name] ?? 0)}. Choose another for this one.`
        );
      }
      // Picking a provider by hand must not skip the quota the auto path
      // enforces. Only the providers we host and pay for count against it:
      // Google Drive and Dropbox live in the user's own cloud account.
      if (isHostedProvider(preferred.name) && !(await options.canUploadToLocal(file.size))) {
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

    // An image Cloudinary would refuse goes where a PDF of its size would.
    const isImage = file.type.startsWith('image/');
    const cloudinaryProvider = this.getProvider('cloudinary');
    if (isImage && cloudinaryProvider.isConfigured() && fitsProvider('cloudinary', file.size)) {
      return cloudinaryProvider;
    }

    const r2Provider = this.getProvider('r2');
    if (r2Provider.isConfigured()) {
      return r2Provider;
    }

    if (fitsProvider('supabase_storage', file.size)) {
      return this.getProvider('supabase_storage');
    }

    // Too large for every provider this deployment hosts. Drive takes it, and
    // it costs the plan nothing.
    if (isDriveConnected) {
      return driveProvider;
    }

    throw new FileTooLargeError(
      `This file is ${formatBytes(file.size)}. Over ${formatStorage(this.largestHostedUpload())}, a file can only go to Google Drive, and Drive is not connected.`
    );
  }
}

export const providerManager = new ProviderManager();
