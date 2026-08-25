import { describe, it, expect } from 'vitest';
import { HttpError, isRetriableError, httpErrorFrom } from './http.utils';

describe('isRetriableError', () => {
  it('gives up on a 4xx — the same request gets the same answer', () => {
    expect(isRetriableError(new HttpError('Storage limit exceeded', 413))).toBe(false);
    expect(isRetriableError(new HttpError('Invalid or expired token', 401))).toBe(false);
    expect(isRetriableError(new HttpError('Access denied', 403))).toBe(false);
  });

  it('retries a 5xx and an explicit rate limit', () => {
    expect(isRetriableError(new HttpError('Internal server error', 500))).toBe(true);
    expect(isRetriableError(new HttpError('Bad gateway', 502))).toBe(true);
    expect(isRetriableError(new HttpError('Too many requests', 429))).toBe(true);
  });

  it('retries errors with no status, such as a dropped connection', () => {
    expect(isRetriableError(new Error('network error'))).toBe(true);
  });
});

describe('httpErrorFrom', () => {
  it('carries the status and the message from the JSON body', async () => {
    const response = new Response(JSON.stringify({ message: 'Storage limit exceeded' }), {
      status: 413,
    });

    const error = await httpErrorFrom(response, 'Failed to get upload URL');

    expect(error.status).toBe(413);
    expect(error.message).toBe('Storage limit exceeded');
  });

  it('uses the fallback message when the body is not JSON', async () => {
    const response = new Response('<html>502</html>', { status: 502 });

    const error = await httpErrorFrom(response, 'Failed to get upload URL');

    expect(error.status).toBe(502);
    expect(error.message).toBe('Failed to get upload URL');
  });
});
