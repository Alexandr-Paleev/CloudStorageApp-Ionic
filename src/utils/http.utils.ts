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
 */
export function isRetriableError(error: unknown): boolean {
  if (error instanceof HttpError) {
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
