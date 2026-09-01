import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import cloudinaryService from './cloudinary.service';
import { HttpError } from '../utils/http.utils';

vi.mock('../supabase/supabase.config', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) } },
}));

vi.mock('../observability/sentry', () => ({ captureException: vi.fn() }));

const AUTHORIZATION = {
  cloudName: 'test-cloud',
  apiKey: 'test-key',
  timestamp: 1_700_000_000,
  signature: 'the-signature',
  folder: 'users/user-1',
  tags: 'user_user-1',
  resourceType: 'image' as const,
};

/** The one XHR the upload opens, captured so the test can answer it. */
let sent: { url: string; body: FormData } | null = null;

class FakeXhr {
  static instances: FakeXhr[] = [];
  upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  status = 200;
  responseText = JSON.stringify({
    public_id: 'users/user-1/photo',
    secure_url: 'https://res.cloudinary.com/photo.png',
    format: 'png',
    bytes: 1024,
  });
  private url = '';

  constructor() {
    FakeXhr.instances.push(this);
  }

  open(_method: string, url: string) {
    this.url = url;
  }

  send(body: FormData) {
    sent = { url: this.url, body };
    // Resolve on the next tick, the way a real request would.
    queueMicrotask(() => this.onload?.());
  }
}

function authorizeWith(response: Partial<Response> & { ok: boolean; status?: number }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response as Response)
  );
}

function file(name = 'photo.png', type = 'image/png') {
  return new File([new Uint8Array(1024)], name, { type });
}

beforeEach(() => {
  sent = null;
  FakeXhr.instances.length = 0;
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  authorizeWith({ ok: true, json: async () => AUTHORIZATION } as unknown as Response);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('isConfigured', () => {
  it('needs only the cloud name now that the server signs uploads', () => {
    // It used to require VITE_CLOUDINARY_UPLOAD_PRESET as well; there is no
    // preset any more, and requiring a removed variable would route every
    // image to R2 instead.
    expect(cloudinaryService.isConfigured()).toBe(true);
  });
});

describe('uploadFile', () => {
  it('asks the server to authorize the upload before sending a byte', async () => {
    await cloudinaryService.uploadFile(file(), 'user-1');

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/cloudinary/sign',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer jwt' }),
      })
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body).toEqual({ fileName: 'photo.png', size: 1024, contentType: 'image/png' });
  });

  it('sends exactly the fields the signature covers', async () => {
    // Cloudinary refuses the upload if the signed set and the sent set differ,
    // and upload_preset in particular is what this replaced.
    await cloudinaryService.uploadFile(file(), 'user-1');

    const fields = [...(sent!.body as FormData).keys()].sort();
    expect(fields).toEqual(['api_key', 'file', 'folder', 'signature', 'tags', 'timestamp']);
    expect(sent!.body.get('signature')).toBe('the-signature');
    expect(sent!.body.get('folder')).toBe('users/user-1');
  });

  it('uploads where the server told it to, not where the client guessed', async () => {
    await cloudinaryService.uploadFile(file(), 'user-1');

    expect(sent!.url).toBe('https://api.cloudinary.com/v1_1/test-cloud/image/upload');
  });

  it('follows the server into the raw endpoint for a PDF', async () => {
    // Cloudinary stores PDFs as `raw`, and the delete path looks for them
    // there — the two have to agree, so only one side decides.
    authorizeWith({
      ok: true,
      json: async () => ({ ...AUTHORIZATION, resourceType: 'raw' }),
    } as unknown as Response);

    await cloudinaryService.uploadFile(file('report.pdf', 'application/pdf'), 'user-1');

    expect(sent!.url).toBe('https://api.cloudinary.com/v1_1/test-cloud/raw/upload');
  });

  it('stops at a refused authorization and never reaches Cloudinary', async () => {
    authorizeWith({
      ok: false,
      status: 413,
      json: async () => ({ message: 'Storage limit exceeded. Using 495.0 MB of 500.0 MB' }),
    } as unknown as Response);

    await expect(cloudinaryService.uploadFile(file(), 'user-1')).rejects.toThrow(
      /Storage limit exceeded/
    );
    expect(sent).toBeNull();
  });

  it('carries the status through, so a refusal is not retried like a blip', async () => {
    authorizeWith({
      ok: false,
      status: 413,
      json: async () => ({ message: 'Storage limit exceeded' }),
    } as unknown as Response);

    const error = await cloudinaryService.uploadFile(file(), 'user-1').catch((e) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(413);
  });

  it("maps Cloudinary's answer onto what the provider stores", async () => {
    const result = await cloudinaryService.uploadFile(file(), 'user-1');

    expect(result).toEqual({
      publicId: 'users/user-1/photo',
      url: 'https://res.cloudinary.com/photo.png',
      format: 'png',
      bytes: 1024,
    });
  });
});

describe('when the deployment cannot sign', () => {
  it('stops offering itself after the server answers 501', async () => {
    // Only the server knows whether CLOUDINARY_API_SECRET is set. Before
    // signing, the client could tell from the upload preset and images fell
    // through to R2 or Supabase Storage; now it can only find out by asking.
    authorizeWith({
      ok: false,
      status: 501,
      json: async () => ({ message: 'Cloudinary is not configured on the server' }),
    } as unknown as Response);

    expect(cloudinaryService.isConfigured()).toBe(true);
    await expect(cloudinaryService.uploadFile(file(), 'user-1')).rejects.toThrow();

    // ProviderManager asks this before every upload, so the next file is
    // routed somewhere that works.
    expect(cloudinaryService.isConfigured()).toBe(false);
  });
});

describe('deleteFile', () => {
  it('falls back to this deployment when no delete URL is configured', async () => {
    // The rollback after a refused quota insert depends on this actually
    // deleting something. It used to warn and return when the variable was
    // unset, which left the asset in the account with no row pointing at it —
    // and an absolute URL is the wrong default the other way round, since a
    // preview build then deletes against production.
    vi.stubEnv('VITE_CLOUDINARY_DELETE_API_URL', '');
    vi.resetModules();
    const fresh = (await import('./cloudinary.service')).default;

    const fetchMock = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal('fetch', fetchMock);

    await fresh.deleteFile('users/user-1/photo');

    expect(fetchMock.mock.calls[0][0]).toBe('/api/cloudinary/delete');
  });

  it('uses the configured URL when a deployment sets one', async () => {
    vi.stubEnv('VITE_CLOUDINARY_DELETE_API_URL', 'https://example.invalid/api/cloudinary/delete');
    vi.resetModules();
    const fresh = (await import('./cloudinary.service')).default;

    const fetchMock = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal('fetch', fetchMock);

    await fresh.deleteFile('users/user-1/photo');

    expect(fetchMock.mock.calls[0][0]).toBe('https://example.invalid/api/cloudinary/delete');
  });
});
