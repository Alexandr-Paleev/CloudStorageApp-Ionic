import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import r2Service from './r2.service';
import { HttpError } from '../utils/http.utils';
import { MULTIPART_THRESHOLD } from '../../lib/multipart';

/* Hoisted: `vi.mock` factories run before the module body, so a plain `const`
   here is still in its temporal dead zone when the uploader is built. */
const { start, run, abort, list } = vi.hoisted(() => ({
  start: vi.fn(),
  run: vi.fn(),
  abort: vi.fn(),
  list: vi.fn(),
}));

vi.mock('../supabase/supabase.config', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) } },
}));

vi.mock('./multipart.upload', () => ({
  createMultipartUploader: () => ({ start, run, abort }),
}));

vi.mock('./upload-store', () => ({ uploadStore: { list: () => list() } }));

const fetchMock = vi.fn();

/** The one PUT the upload opens, captured so a test can answer it. */
class FakeXhr {
  static last: FakeXhr | null = null;
  upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 200;
  headers: Record<string, string> = { ETag: '"tag"' };
  aborted = false;

  constructor() {
    FakeXhr.last = this;
  }
  open() {}
  setRequestHeader() {}
  getResponseHeader(name: string) {
    return this.headers[name] ?? null;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  send() {
    queueMicrotask(() => this.onload?.());
  }
}

/* The bytes are kept small and `size` is declared, because the only thing the
   service reads is `file.size` — and allocating sixteen real megabytes to prove
   which branch it takes would be sixteen megabytes spent on nothing. */
const file = (size: number, name = 'a.bin') => {
  const f = new File([new Uint8Array(8)], name, { type: 'application/octet-stream' });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

/** A file the service will route to the single PUT, and one it will not. */
const SMALL = 1024;
const BIG = MULTIPART_THRESHOLD + 1;

const jsonOk = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  vi.clearAllMocks();
  FakeXhr.last = null;
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  fetchMock.mockResolvedValue(
    jsonOk({ uploadUrl: 'https://r2.test/put', key: 'users/u1/a.bin', url: 'https://r2.test/get' })
  );
  start.mockResolvedValue('users/u1/big.bin');
  run.mockResolvedValue('users/u1/big.bin');
  list.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const actionsCalled = () =>
  fetchMock.mock.calls.map(([url]) => String(url).split('/api/r2/')[1]).filter(Boolean);

describe('which path an upload takes', () => {
  /* The multipart handshake is three extra round trips. On a file that would
     have finished in one PUT that is most of the time budget — and on a large
     one it is what makes the upload resumable at all. */
  it('sends a small file as one PUT', async () => {
    await r2Service.uploadFile(file(SMALL), 'user-1');

    expect(start).not.toHaveBeenCalled();
    expect(actionsCalled()).toContain('presign-upload');
  });

  it('sends a file over the threshold in parts', async () => {
    await r2Service.uploadFile(file(BIG), 'user-1');

    expect(start).toHaveBeenCalledTimes(1);
    expect(actionsCalled()).not.toContain('presign-upload');
  });

  it('signs a download URL for whichever path ran', async () => {
    const result = await r2Service.uploadFile(file(SMALL), 'user-1');

    expect(actionsCalled()).toContain('presign-download');
    expect(result).toEqual({ key: 'users/u1/a.bin', url: 'https://r2.test/get' });
  });
});

/**
 * What the interface is told when the server refuses.
 *
 * 413 is the storage quota, and it is the one refusal a person can act on —
 * delete something, or upgrade. Flattened into "upload failed" it becomes a
 * bug report. `httpErrorFrom` carries the status and the server's own sentence,
 * and this is the test that keeps it doing so.
 */
describe('a refusal from the API', () => {
  it('carries a full quota through as 413 with its message', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 413,
      json: async () => ({ message: 'Storage limit exceeded. Using 500 MB of 500 MB.' }),
    });

    const failure = await r2Service.uploadFile(file(SMALL), 'user-1').catch((e) => e);
    expect(failure).toBeInstanceOf(HttpError);
    expect((failure as HttpError).status).toBe(413);
    expect((failure as Error).message).toMatch(/Storage limit exceeded/);
  });

  it('carries a rate limit through as 429', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ message: 'Too many upload requests.' }),
    });

    const failure = await r2Service.uploadFile(file(SMALL), 'user-1').catch((e) => e);
    expect((failure as HttpError).status).toBe(429);
  });
});

describe('the single PUT itself', () => {
  it('reports progress as a percentage of the file', async () => {
    const seen: number[] = [];
    const upload = r2Service.uploadFile(file(SMALL), 'user-1', (p) => seen.push(p));

    await vi.waitFor(() => expect(FakeXhr.last).not.toBeNull());
    FakeXhr.last!.upload.onprogress?.({ lengthComputable: true, loaded: 512 } as ProgressEvent);
    await upload;

    expect(seen).toEqual([50]);
  });

  it('rejects with the status when R2 refuses the body', async () => {
    class Refusing extends FakeXhr {
      override send() {
        this.status = 403;
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('XMLHttpRequest', Refusing);

    const failure = await r2Service.uploadFile(file(SMALL), 'user-1').catch((e) => e);
    expect(failure).toBeInstanceOf(HttpError);
    expect((failure as HttpError).status).toBe(403);
  });

  it('aborts when the signal fires, and says so as an AbortError', async () => {
    /* This one has to stay in flight: the default fake finishes on the next
       microtask, and an abort after the upload is already done proves nothing. */
    class Hanging extends FakeXhr {
      override send() {}
    }
    vi.stubGlobal('XMLHttpRequest', Hanging);

    const controller = new AbortController();
    const upload = r2Service.uploadFile(file(SMALL), 'user-1', undefined, {
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(FakeXhr.last).not.toBeNull());
    controller.abort();

    const failure = await upload.catch((e) => e);
    expect((failure as DOMException).name).toBe('AbortError');
    expect(FakeXhr.last!.aborted).toBe(true);
  });

  it('calls a network failure a network failure', async () => {
    class Broken extends FakeXhr {
      override send() {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('XMLHttpRequest', Broken);

    await expect(r2Service.uploadFile(file(SMALL), 'user-1')).rejects.toThrow(
      'R2 upload network error'
    );
  });
});

describe('interrupted uploads', () => {
  it('lists what is still resumable', async () => {
    list.mockResolvedValue([{ key: 'users/u1/movie.mp4' }]);
    await expect(r2Service.resumableUploads()).resolves.toEqual([{ key: 'users/u1/movie.mp4' }]);
  });

  it('picks one up and signs a URL for the finished object', async () => {
    const record = { key: 'users/u1/movie.mp4', uploadId: 'up-1' } as never;
    await expect(r2Service.resumeUpload(record)).resolves.toEqual({
      key: 'users/u1/big.bin',
      url: 'https://r2.test/get',
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('releases the parts when one is abandoned', async () => {
    await r2Service.discardUpload({ key: 'users/u1/movie.mp4', uploadId: 'up-1' });
    expect(abort).toHaveBeenCalledWith({ key: 'users/u1/movie.mp4', uploadId: 'up-1' });
  });

  /* The progress bar divides by partCount. A record written before the first
     part was planned has none, and the bar would read NaN. */
  it('reports no progress rather than NaN for a record with no parts', () => {
    expect(r2Service.uploadedFraction({ partCount: 0, completed: [] } as never)).toBe(0);
    expect(r2Service.uploadedFraction({ partCount: 4, completed: [1, 2] } as never)).toBe(0.5);
  });
});

describe('deleting and reading', () => {
  it('asks the API to delete by key', async () => {
    await r2Service.deleteFile('users/u1/a.bin');

    expect(actionsCalled()).toEqual(['delete']);
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ key: 'users/u1/a.bin' });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
  });

  it('asks for a signed URL with the lifetime it was given', async () => {
    fetchMock.mockResolvedValue(jsonOk({ url: 'https://r2.test/signed' }));

    await expect(r2Service.getSignedDownloadUrl('users/u1/a.bin', 60)).resolves.toBe(
      'https://r2.test/signed'
    );
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ key: 'users/u1/a.bin', expiresIn: 60 });
  });

  it('is configured, since the suite supplies a bucket name', () => {
    expect(r2Service.isConfigured()).toBe(true);
  });
});

/**
 * A deployment with no R2 at all.
 *
 * The bucket name is read once at module load, so this is the one case that
 * needs the module built again without it — and it is worth the trouble: the
 * alternative to failing here is a presign request that answers with something
 * unhelpful from a bucket that does not exist.
 */
describe('when R2 is not configured', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const withoutBucket = async () => {
    vi.stubEnv('VITE_R2_BUCKET_NAME', '');
    vi.resetModules();
    return (await import('./r2.service')).default;
  };

  it('refuses every call that would need the bucket, without asking the API', async () => {
    const service = await withoutBucket();
    expect(service.isConfigured()).toBe(false);

    await expect(service.uploadFile(file(SMALL), 'user-1')).rejects.toThrow('not configured');
    await expect(service.deleteFile('k')).rejects.toThrow('not configured');
    await expect(service.getSignedDownloadUrl('k')).rejects.toThrow('not configured');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
