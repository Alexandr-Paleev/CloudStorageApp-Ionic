import { describe, it, expect, beforeEach, vi } from 'vitest';
import { providerManager } from './ProviderManager';
import { IStorageProvider } from './storage.provider';
import { FileTooLargeError } from './upload-limits';

/**
 * The most consequential branch in the client: it decides where a file lands,
 * and — for the providers this app pays for — whether the quota is consulted
 * at all. `register()` replaces by name, so swapping the five real providers
 * for stubs leaves the selection logic itself untouched.
 */
type StubOptions = {
  configured?: boolean;
  connected?: boolean;
};

function stub(name: string, options: StubOptions = {}): IStorageProvider {
  const provider: IStorageProvider = {
    name,
    isConfigured: () => options.configured ?? true,
    upload: vi.fn(),
    delete: vi.fn(),
  };

  if (options.connected !== undefined) {
    provider.isConnected = async () => options.connected as boolean;
  }

  return provider;
}

function install(overrides: Record<string, StubOptions> = {}) {
  const names = ['cloudinary', 'r2', 'supabase_storage', 'googledrive', 'dropbox'];
  for (const name of names) {
    // Google Drive and Dropbox are asked whether they are connected; the three
    // hosted providers are not, and must not answer the question at all.
    const defaults: StubOptions =
      name === 'googledrive' || name === 'dropbox' ? { connected: false } : {};
    providerManager.register(stub(name, { ...defaults, ...overrides[name] }));
  }
}

const image = { name: 'photo.png', type: 'image/png', size: 1_000 } as File;
const pdf = { name: 'report.pdf', type: 'application/pdf', size: 1_000 } as File;

const MB = 1024 * 1024;
/* A phone's photo, over Cloudinary's 10 MB, and a scan over Supabase
   Storage's 50 MB. */
const largePhoto = { name: 'IMG_0001.jpg', type: 'image/jpeg', size: 12 * MB } as File;
const largeScan = { name: 'scan.pdf', type: 'application/pdf', size: 60 * MB } as File;

const allow = async () => true;
const deny = async () => false;

beforeEach(() => {
  install();
});

describe('selectProvider — a provider the user picked by hand', () => {
  it('refuses one the plan does not include', async () => {
    await expect(
      providerManager.selectProvider(pdf, 'user-1', {
        canUploadToLocal: allow,
        preferredProvider: 'dropbox',
        allowedProviders: ['cloudinary', 'r2', 'supabase_storage'],
      })
    ).rejects.toThrow(/not available on your plan/);
  });

  it('refuses one the deployment never configured', async () => {
    install({ r2: { configured: false } });

    await expect(
      providerManager.selectProvider(pdf, 'user-1', {
        canUploadToLocal: allow,
        preferredProvider: 'r2',
        allowedProviders: ['r2'],
      })
    ).rejects.toThrow(/not configured/);
  });

  it('refuses one the user has not authorized yet', async () => {
    install({ dropbox: { connected: false } });

    await expect(
      providerManager.selectProvider(pdf, 'user-1', {
        canUploadToLocal: allow,
        preferredProvider: 'dropbox',
        allowedProviders: ['dropbox'],
      })
    ).rejects.toThrow(/not connected/);
  });

  it('does not let the choice walk past the quota', async () => {
    // The whole point of the manual path having its own quota check: without
    // it, picking a backend from the dropdown would be a way to keep uploading
    // past a full plan.
    for (const name of ['cloudinary', 'r2', 'supabase_storage']) {
      await expect(
        providerManager.selectProvider(pdf, 'user-1', {
          canUploadToLocal: deny,
          preferredProvider: name,
          allowedProviders: [name],
        })
      ).rejects.toThrow(/Storage limit exceeded/);
    }
  });

  it('lets a full account still upload to storage it owns', async () => {
    install({ dropbox: { connected: true } });

    const provider = await providerManager.selectProvider(pdf, 'user-1', {
      canUploadToLocal: deny,
      preferredProvider: 'dropbox',
      allowedProviders: ['dropbox'],
    });

    expect(provider.name).toBe('dropbox');
  });

  it('asks the quota exactly once, for the file being uploaded', async () => {
    const canUploadToLocal = vi.fn(async () => true);

    await providerManager.selectProvider({ ...pdf, size: 4_096 } as File, 'user-1', {
      canUploadToLocal,
      preferredProvider: 'r2',
      allowedProviders: ['r2'],
    });

    expect(canUploadToLocal).toHaveBeenCalledExactlyOnceWith(4_096);
  });

  it('ignores the preference when the caller passes no plan to check it against', async () => {
    // Current behaviour, and it fails safe: with no allowedProviders there is
    // nothing to authorize against, so the automatic path decides instead.
    const provider = await providerManager.selectProvider(image, 'user-1', {
      canUploadToLocal: allow,
      preferredProvider: 'dropbox',
    });

    expect(provider.name).toBe('cloudinary');
  });
});

describe('selectProvider — the automatic path', () => {
  it('sends images to Cloudinary and everything else to R2', async () => {
    const forImage = await providerManager.selectProvider(image, 'user-1', {
      canUploadToLocal: allow,
    });
    const forPdf = await providerManager.selectProvider(pdf, 'user-1', {
      canUploadToLocal: allow,
    });

    expect(forImage.name).toBe('cloudinary');
    expect(forPdf.name).toBe('r2');
  });

  it('falls down the chain when a backend is not configured', async () => {
    install({ cloudinary: { configured: false } });
    expect(
      (await providerManager.selectProvider(image, 'user-1', { canUploadToLocal: allow })).name
    ).toBe('r2');

    install({ cloudinary: { configured: false }, r2: { configured: false } });
    expect(
      (await providerManager.selectProvider(image, 'user-1', { canUploadToLocal: allow })).name
    ).toBe('supabase_storage');
  });

  it('honours an explicit Google Drive request', async () => {
    install({ googledrive: { connected: true } });

    const provider = await providerManager.selectProvider(image, 'user-1', {
      canUploadToLocal: allow,
      useGoogleDrive: true,
    });

    expect(provider.name).toBe('googledrive');
  });

  it('ignores that request when Drive is not connected', async () => {
    const provider = await providerManager.selectProvider(image, 'user-1', {
      canUploadToLocal: allow,
      useGoogleDrive: true,
    });

    expect(provider.name).toBe('cloudinary');
  });

  it("does not read the quota to answer a request for the user's own Drive", async () => {
    // The quota read can fail — a profiles blip, or migrations/007 not applied
    // yet — and Drive costs the plan nothing. Failing this path because the
    // *local* quota was unreadable breaks the one route that exists for when
    // local storage cannot be used.
    install({ googledrive: { connected: true } });
    const canUploadToLocal = vi.fn(async () => {
      throw new Error('profiles.bytes_used is missing');
    });

    const provider = await providerManager.selectProvider(image, 'user-1', {
      canUploadToLocal,
      useGoogleDrive: true,
    });

    expect(provider.name).toBe('googledrive');
    expect(canUploadToLocal).not.toHaveBeenCalled();
  });

  it('overflows a full account into a connected Drive', async () => {
    install({ googledrive: { connected: true } });

    const provider = await providerManager.selectProvider(pdf, 'user-1', {
      canUploadToLocal: deny,
    });

    expect(provider.name).toBe('googledrive');
  });

  it('stops a full account that has nowhere else to go', async () => {
    await expect(
      providerManager.selectProvider(pdf, 'user-1', { canUploadToLocal: deny })
    ).rejects.toThrow(/Storage limit exceeded/);
  });
});

describe('getProvider', () => {
  it('names the provider it could not find', () => {
    expect(() => providerManager.getProvider('onedrive')).toThrow(
      'Storage provider "onedrive" not found'
    );
  });
});

/* What the upload page may offer. It offered every provider the plan named,
   and production has R2 switched off and Dropbox never set up. */
describe('configuredNames', () => {
  it('names only the providers this deployment has set up', () => {
    install({ r2: { configured: false }, dropbox: { configured: false } });
    expect(providerManager.configuredNames()).toEqual([
      'cloudinary',
      'supabase_storage',
      'googledrive',
    ]);
  });
});

/* Each provider's limit, asked before a byte travels. A 12 MB photo went to
   Cloudinary in full and was refused at the end, and a 60 MB PDF the same
   way to Supabase Storage. Production has R2 switched off. */
describe('selectProvider — a file a provider would refuse', () => {
  it('sends an image Cloudinary would refuse to Supabase Storage instead', async () => {
    install({ r2: { configured: false } });

    const provider = await providerManager.selectProvider(largePhoto, 'user-1', {
      canUploadToLocal: allow,
    });

    expect(provider.name).toBe('supabase_storage');
  });

  it('sends it to R2 where R2 is set up, as a PDF of its size would go', async () => {
    const provider = await providerManager.selectProvider(largePhoto, 'user-1', {
      canUploadToLocal: allow,
    });

    expect(provider.name).toBe('r2');
  });

  it('sends a file over 50 MB to a connected Drive when no hosted provider takes it', async () => {
    install({ r2: { configured: false }, googledrive: { connected: true } });

    const provider = await providerManager.selectProvider(largeScan, 'user-1', {
      canUploadToLocal: allow,
    });

    expect(provider.name).toBe('googledrive');
  });

  it('refuses it before it travels when Drive is not connected, and says where it can go', async () => {
    install({ r2: { configured: false } });

    const choice = providerManager.selectProvider(largeScan, 'user-1', {
      canUploadToLocal: allow,
    });

    await expect(choice).rejects.toBeInstanceOf(FileTooLargeError);
    await expect(choice).rejects.toThrow(
      'This file is 60.0 MB. Over 50 MB, a file can only go to Google Drive, and Drive is not connected.'
    );
  });

  it('lets R2 take a file over 50 MB', async () => {
    const provider = await providerManager.selectProvider(largeScan, 'user-1', {
      canUploadToLocal: allow,
    });

    expect(provider.name).toBe('r2');
  });

  it('refuses a provider picked by hand that would refuse the file', async () => {
    await expect(
      providerManager.selectProvider(largePhoto, 'user-1', {
        canUploadToLocal: allow,
        preferredProvider: 'cloudinary',
        allowedProviders: ['cloudinary', 'supabase_storage'],
      })
    ).rejects.toThrow(
      'Provider "cloudinary" takes files up to 10 MB. Choose another for this one.'
    );
  });
});

/* What the upload page weighs a selection against, to offer Drive before
   anything is sent. */
describe('largestHostedUpload', () => {
  it('is what Supabase Storage takes where R2 is not set up', () => {
    install({ r2: { configured: false } });
    expect(providerManager.largestHostedUpload()).toBe(50 * MB);
  });

  it('has no ceiling where R2 is set up', () => {
    expect(providerManager.largestHostedUpload()).toBe(Infinity);
  });
});
