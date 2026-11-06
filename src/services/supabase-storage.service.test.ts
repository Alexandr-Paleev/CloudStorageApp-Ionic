import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import supabaseStorageService from './supabase-storage.service';
import { HttpError } from '../utils/http.utils';

const { bucket } = vi.hoisted(() => ({
  bucket: {
    createSignedUploadUrl: vi.fn(),
    createSignedUrl: vi.fn(),
  },
}));

vi.mock('../supabase/supabase.config', () => ({
  supabase: {
    storage: { from: () => bucket },
    auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) },
  },
}));

vi.mock('../env', () => ({ env: { VITE_SUPABASE_ANON_KEY: 'anon-key' } }));

vi.mock('../observability/sentry', () => ({ captureException: vi.fn() }));

const SIGNED =
  'https://project.supabase.co/storage/v1/object/upload/sign/files/user-1/1_report.pdf?token=t';

type Progress = Pick<ProgressEvent, 'lengthComputable' | 'loaded' | 'total'>;

/** The one XHR an upload opens, kept so the test can read what was sent. */
class FakeXhr {
  static last: FakeXhr | null = null;
  /** What happens once the request is sent: by default, the browser measures
   *  half the body, then all of it, and Storage answers 200. */
  static answer: (xhr: FakeXhr) => void;

  upload = { onprogress: null as ((event: Progress) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  status = 200;
  responseText = '{"Key":"files/user-1/1_report.pdf"}';
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: FormData | null = null;

  constructor() {
    FakeXhr.last = this;
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  send(body: FormData) {
    this.body = body;
    queueMicrotask(() => FakeXhr.answer(this));
  }
}

function pdf() {
  return new File([new Uint8Array(1_000)], 'report.pdf', { type: 'application/pdf' });
}

beforeEach(() => {
  vi.clearAllMocks();
  FakeXhr.last = null;
  FakeXhr.answer = (xhr) => {
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 520, total: 1_040 });
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1_040, total: 1_040 });
    xhr.onload?.();
  };
  vi.stubGlobal('XMLHttpRequest', FakeXhr);

  bucket.createSignedUploadUrl.mockImplementation(async (path: string) => ({
    data: { signedUrl: SIGNED, path, token: 't' },
    error: null,
  }));
  bucket.createSignedUrl.mockResolvedValue({
    data: { signedUrl: 'https://project.supabase.co/storage/v1/object/sign/view' },
    error: null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uploadFile', () => {
  /* It was drawn: 10% before the request and 100% after it, so a 40 MB PDF
     on a slow connection sat at 10% for minutes. */
  it('reports the progress the browser measures', async () => {
    const seen: { progress: number; bytesTransferred: number }[] = [];

    await supabaseStorageService.uploadFile(pdf(), 'user-1', ({ progress, bytesTransferred }) =>
      seen.push({ progress, bytesTransferred })
    );

    // The form around the file is counted too: the bytes never pass the file's.
    expect(seen).toEqual([
      { progress: 50, bytesTransferred: 520 },
      { progress: 100, bytesTransferred: 1_000 },
    ]);
  });

  it('sends what supabase-js sends, the file in a form, to an address signed for its path', async () => {
    const result = await supabaseStorageService.uploadFile(pdf(), 'user-1');

    const path = bucket.createSignedUploadUrl.mock.calls[0]![0] as string;
    expect(path).toMatch(/^user-1\/\d+_report\.pdf$/);

    const xhr = FakeXhr.last!;
    expect(xhr.method).toBe('PUT');
    expect(xhr.url).toBe(SIGNED);
    expect(xhr.headers).toEqual({
      apikey: 'anon-key',
      Authorization: 'Bearer jwt',
      'x-upsert': 'false',
    });
    expect(xhr.body!.get('cacheControl')).toBe('3600');
    expect(xhr.body!.get('')).toBeInstanceOf(File);

    expect(bucket.createSignedUrl).toHaveBeenCalledWith(path, 3600);
    expect(result).toEqual({
      path,
      url: 'https://project.supabase.co/storage/v1/object/sign/view',
    });
  });

  it('fails with the status and the reason Storage gives, so a refusal is not sent again', async () => {
    FakeXhr.answer = (xhr) => {
      xhr.status = 413;
      xhr.responseText = JSON.stringify({
        statusCode: '413',
        error: 'Payload too large',
        message: 'The object exceeded the maximum allowed size',
      });
      xhr.onload?.();
    };

    const upload = supabaseStorageService.uploadFile(pdf(), 'user-1');

    await expect(upload).rejects.toBeInstanceOf(HttpError);
    await expect(upload).rejects.toMatchObject({
      status: 413,
      message: 'The object exceeded the maximum allowed size',
    });
  });

  it('sends nothing when the address cannot be signed', async () => {
    bucket.createSignedUploadUrl.mockResolvedValue({
      data: null,
      error: new Error('new row violates row-level security policy'),
    });

    await expect(supabaseStorageService.uploadFile(pdf(), 'user-1')).rejects.toThrow(
      'new row violates row-level security policy'
    );
    expect(FakeXhr.last).toBeNull();
  });

  it('says a connection that dropped is a network failure, which may be tried again', async () => {
    FakeXhr.answer = (xhr) => xhr.onerror?.();

    await expect(supabaseStorageService.uploadFile(pdf(), 'user-1')).rejects.toThrow(
      'Supabase Storage upload network error'
    );
  });
});
