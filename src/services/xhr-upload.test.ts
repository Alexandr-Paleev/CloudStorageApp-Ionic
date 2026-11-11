import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError, isRetriableError } from '../utils/http.utils';
import {
  STALL_MS,
  UploadStalledError,
  readAnswer,
  sendUpload,
  stoppedOnPurpose,
  type UploadRequest,
} from './xhr-upload';

/** A request that does nothing until the test says what happens to it. */
class FakeXhr {
  static last: FakeXhr | null = null;
  static sent = 0;

  upload: { onprogress: ((event: ProgressEvent) => void) | null; onload: (() => void) | null } = {
    onprogress: null,
    onload: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  onprogress: (() => void) | null = null;
  status = 0;
  responseText = '';
  headers: Record<string, string> = {};
  aborted = false;

  constructor() {
    FakeXhr.last = this;
  }
  open() {}
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send() {
    FakeXhr.sent += 1;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }

  /** What the browser measures of the body going out. */
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent);
  }
  /** The provider's answer. */
  answer(status: number, text = '') {
    this.status = status;
    this.responseText = text;
    this.onload?.();
  }
}

const xhr = () => {
  if (!FakeXhr.last) throw new Error('No request was made');
  return FakeXhr.last;
};

const send = (extra: Partial<UploadRequest> = {}) =>
  sendUpload({
    provider: 'Somewhere',
    method: 'PUT',
    url: 'https://upload.example/file',
    body: new Blob(['x']),
    ...extra,
  });

beforeEach(() => {
  FakeXhr.last = null;
  FakeXhr.sent = 0;
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('sendUpload', () => {
  it('resolves with the request once the provider says 2xx, its headers sent', async () => {
    const sent = send({ headers: { 'x-upsert': 'false' } });
    xhr().answer(201, '{"id":"1"}');

    await expect(sent).resolves.toBe(xhr());
    expect(xhr().headers).toEqual({ 'x-upsert': 'false' });
  });

  it('refuses with the status, so a 4xx is not sent twice more', async () => {
    const sent = send();
    xhr().answer(403);
    const error = await sent.catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({
      status: 403,
      message: 'Somewhere upload failed with status 403',
    });
    expect(isRetriableError(error)).toBe(false);
  });

  it("says a refusal in the provider's own words when it is given them", async () => {
    const sent = send({ refusal: (request) => new HttpError(`No: ${request.responseText}`, 413) });
    xhr().answer(413, 'too big');

    await expect(sent).rejects.toMatchObject({ status: 413, message: 'No: too big' });
  });

  it('rejects, rather than hanging, when those words cannot be put together', async () => {
    const sent = send({
      refusal: () => {
        throw new Error('the refusal broke');
      },
    });
    xhr().answer(500);

    await expect(sent).rejects.toThrow('the refusal broke');
  });

  it('says a network failure as one, and it is sent again', async () => {
    const sent = send();
    xhr().onerror?.();
    const error = await sent.catch((e: unknown) => e);

    expect(error).toMatchObject({ message: 'Somewhere upload network error' });
    expect(isRetriableError(error)).toBe(true);
  });

  it('hands on the progress of the body as the browser measures it', async () => {
    const onProgress = vi.fn();
    const sent = send({ onProgress });
    xhr().progress(512, 2048);
    xhr().answer(200);
    await sent;

    expect(onProgress).toHaveBeenCalledWith(512, 2048);
  });
});

describe('a signal', () => {
  it('stops the request, with the AbortError the queue takes as a choice', async () => {
    const controller = new AbortController();
    const sent = send({ signal: controller.signal });
    controller.abort();
    const error = await sent.catch((e: unknown) => e);

    expect(xhr().aborted).toBe(true);
    expect(error).toMatchObject({ name: 'AbortError' });
    expect(stoppedOnPurpose(error)).toBe(true);
    expect(isRetriableError(error)).toBe(false);
  });

  it('already aborted, sends nothing at all', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(send({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeXhr.sent).toBe(0);
  });

  it('is let go once the request has settled', async () => {
    const controller = new AbortController();
    const sent = send({ signal: controller.signal });
    xhr().answer(200);
    await sent;
    controller.abort();

    expect(xhr().aborted).toBe(false);
  });
});

describe('a request that goes quiet', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('is given up once nothing has moved for STALL_MS, and is sent again', async () => {
    const sent = send();
    vi.advanceTimersByTime(STALL_MS);
    const error = await sent.catch((e: unknown) => e);

    expect(xhr().aborted).toBe(true);
    expect(error).toBeInstanceOf(UploadStalledError);
    expect(error).toMatchObject({
      message:
        'The upload to Somewhere stopped moving for a minute. Check the connection and try again.',
    });
    expect(stoppedOnPurpose(error)).toBe(false);
    expect(isRetriableError(error)).toBe(true);
  });

  it('is kept for as long as bytes go on moving, however slowly', async () => {
    const sent = send();
    for (let sentSoFar = 1; sentSoFar <= 5; sentSoFar++) {
      vi.advanceTimersByTime(STALL_MS - 1);
      xhr().progress(sentSoFar, 10);
    }
    xhr().answer(200);

    await expect(sent).resolves.toBe(xhr());
  });

  it('gives the provider a whole STALL_MS to answer once the last byte has gone', async () => {
    const sent = send();
    vi.advanceTimersByTime(STALL_MS - 1);
    xhr().upload.onload?.();
    vi.advanceTimersByTime(STALL_MS - 1);
    xhr().onprogress?.();
    vi.advanceTimersByTime(STALL_MS - 1);
    xhr().answer(200);

    await expect(sent).resolves.toBe(xhr());
  });

  it('leaves no timer behind once it has settled', async () => {
    const sent = send();
    xhr().answer(200);
    await sent;

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('readAnswer', () => {
  const answered = (responseText: string) => ({ responseText }) as XMLHttpRequest;

  it('reads what the provider answered', () => {
    expect(readAnswer<{ id: string }>(answered('{"id":"f1"}'), 'Google Drive')).toEqual({
      id: 'f1',
    });
  });

  it('says an answer it cannot read as that, so the upload fails instead of hanging', () => {
    expect(() => readAnswer(answered('<html>Bad gateway</html>'), 'Cloudinary')).toThrow(
      'Cloudinary took the file, but its answer could not be read'
    );
  });
});
