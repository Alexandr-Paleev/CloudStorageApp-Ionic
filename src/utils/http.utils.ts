/**
 * Error from one of the app's own API routes, carrying the HTTP status so
 * callers (and the retry helper) can tell a permanent rejection from a blip.
 */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * A 4xx is the request's own fault — repeating it produces the same answer.
 * The exception is 429, where the server is explicitly asking us to come back.
 *
 * 501 is the other way round: a 5xx that will never come good. Our own routes
 * use it for "this deployment has no credentials for that provider", and
 * retrying that only makes the user wait through the backoff twice.
 */
export function isRetriableError(error: unknown): boolean {
  /* A paused upload and a cancelled request are decisions, not failures.
     Retrying one restarts work the user just stopped — and, for a paused
     multipart upload, does it three times before giving up. */
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'UploadPausedError'))
    return false;

  if (error instanceof HttpError) {
    if (error.status === 501) return false;
    return error.status >= 500 || error.status === 429;
  }
  // Network failures and unknown errors are worth another attempt
  return true;
}

/** Builds an HttpError from a failed fetch Response, using its JSON message when present */
export async function httpErrorFrom(response: Response, fallbackMessage: string) {
  const body = await response.json().catch(() => null);
  return new HttpError(body?.message || fallbackMessage, response.status);
}
