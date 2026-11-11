import { HttpError } from '../utils/http.utils';

/**
 * One upload sent with XHR, and the one place that says how one ends.
 *
 * XHR rather than fetch because fetch still reports no upload progress. Each
 * provider had its own copy of this, five in all, and between them:
 *
 * - None gave up. A phone that went from Wi-Fi to LTE in the middle of a PDF
 *   kept a connection nothing would ever answer on, the bar stood still, and
 *   the queue behind it waited with it. The only way out was to reload the
 *   page, through the browser asking whether to leave.
 * - Only R2 could be stopped, so only R2 had a button for it.
 * - Three read a successful answer with `JSON.parse` inside `onload`. A throw
 *   there happens in the browser's event handler, not in the promise, and the
 *   promise never settled.
 *
 * So the answer is the request itself, resolved once the provider has said
 * 2xx, and whatever reads it does so after an `await`, where a throw rejects
 * like any other. The request gives up once nothing has moved, either way,
 * for STALL_MS: a slow connection keeps it alive, a dead one does not. And a
 * signal stops it, as R2's Pause always could.
 */
export function sendUpload({
  provider,
  method,
  url,
  headers = {},
  body,
  onProgress,
  signal,
  refusal,
}: UploadRequest): Promise<XMLHttpRequest> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(aborted());
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);

    let stalled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const moved = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        stalled = true;
        xhr.abort();
      }, STALL_MS);
    };

    const stop = () => xhr.abort();
    const settle = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
    };

    xhr.upload.onprogress = (event) => {
      moved();
      if (onProgress && event.lengthComputable) onProgress(event.loaded, event.total);
    };
    // The last byte sent: the provider gets a whole STALL_MS to answer.
    xhr.upload.onload = moved;
    // And its answer arriving is movement too.
    xhr.onprogress = moved;

    xhr.onload = () => {
      settle();
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr);
        return;
      }
      try {
        reject(
          refusal?.(xhr) ??
            new HttpError(`${provider} upload failed with status ${xhr.status}`, xhr.status)
        );
      } catch (error) {
        reject(error);
      }
    };
    xhr.onerror = () => {
      settle();
      reject(new Error(`${provider} upload network error`));
    };
    xhr.onabort = () => {
      settle();
      reject(stalled ? new UploadStalledError(provider) : aborted());
    };

    signal?.addEventListener('abort', stop, { once: true });
    moved();
    xhr.send(body);
  });
}

export interface UploadRequest {
  /** As the messages name it: 'Cloudinary', 'Google Drive', and so on. */
  provider: string;
  method: 'POST' | 'PUT';
  url: string;
  headers?: Record<string, string>;
  body: XMLHttpRequestBodyInit;
  /** Bytes of the body sent so far, of how many. A form counts its own fields too. */
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
  /**
   * The error for an answer outside 2xx, in the provider's own words. Without
   * one, an HttpError with the status. Either way the status should come
   * along: the retry helper sends a request it has no status for again.
   */
  refusal?: (xhr: XMLHttpRequest) => Error;
}

/**
 * How long an upload may go with nothing sent and nothing received. A
 * minute: long enough for a provider to take in a large file once the last
 * byte has gone, short enough that a dead connection is not mistaken for a
 * slow one for long. It is retried, as a network error is.
 */
export const STALL_MS = 60_000;

/** An upload that went quiet for STALL_MS and was given up. */
export class UploadStalledError extends Error {
  constructor(provider: string) {
    super(
      `The upload to ${provider} stopped moving for a minute. Check the connection and try again.`
    );
    this.name = 'UploadStalledError';
  }
}

/** What a stopped upload rejects with, the name the queue and the retry helper know. */
function aborted(): DOMException {
  return new DOMException('Upload aborted', 'AbortError');
}

/** Whether an upload was stopped by its signal: a Cancel or a Pause, which is a choice, not a fault. */
export function stoppedOnPurpose(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === 'AbortError';
}

/**
 * A provider's answer to a successful upload, read. It said 2xx, so the file
 * is there: an answer that cannot be read is said as that, rather than as a
 * JSON parser's complaint about a character.
 */
export function readAnswer<T>(xhr: XMLHttpRequest, provider: string): T {
  try {
    return JSON.parse(xhr.responseText) as T;
  } catch {
    throw new Error(`${provider} took the file, but its answer could not be read`);
  }
}
