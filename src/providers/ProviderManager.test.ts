import { describe, it, expect, beforeEach, vi } from 'vitest';
import { providerManager } from './ProviderManager';
import { IStorageProvider } from './storage.provider';

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
