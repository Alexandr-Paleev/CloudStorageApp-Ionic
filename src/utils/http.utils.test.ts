import { describe, it, expect } from 'vitest';
import { HttpError, comeBackAt, isRetriableError, httpErrorFrom } from './http.utils';

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

  it('gives up on a 501 — the deployment is missing credentials, not busy', () => {
    // /api/cloudinary/sign answers 501 when the server has no Cloudinary
    // secret. Retrying only makes the user wait through the backoff twice for
    // the same answer.
    expect(isRetriableError(new HttpError('Cloudinary is not configured', 501))).toBe(false);
  });

  /* A retry would only swap "connect Drive again" for "Drive is not connected". */
  it('gives up when Google Drive asks to be connected again', () => {
    const error = new Error('Google Drive needs to be connected again');
    error.name = 'GoogleDriveAuthError';
    expect(isRetriableError(error)).toBe(false);
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

  it('says, for a spent day, when the person can go on, in their own time', async () => {
    const retryAt = new Date(Date.now() + 3 * 3600_000);
    const response = new Response(
      JSON.stringify({
        message: 'You have asked as many questions today as a day allows.',
        retryAt,
      }),
      { status: 429 }
    );

    const error = await httpErrorFrom(response, 'Failed');

    expect(error.status).toBe(429);
    expect(error.retryAt).toEqual(retryAt);
    expect(error.message).toMatch(
      /^You have asked as many questions today as a day allows\. You can try again (tomorrow )?after /
    );
    expect(error.message).toContain(
      retryAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    );
  });

  it('adds nothing to a minute’s limit, whose message already says so', async () => {
    const response = new Response(
      JSON.stringify({
        message: 'Too many searches. Try again in a minute.',
        retryAt: new Date(Date.now() + 40_000).toISOString(),
      }),
      { status: 429 }
    );

    const error = await httpErrorFrom(response, 'Failed');

    expect(error.message).toBe('Too many searches. Try again in a minute.');
  });

  it('keeps the message as it was when a 429 says no moment, or a broken one', async () => {
    for (const retryAt of [undefined, 'soon']) {
      const response = new Response(JSON.stringify({ message: 'Slow down.', retryAt }), {
        status: 429,
      });
      const error = await httpErrorFrom(response, 'Failed');
      expect(error.message).toBe('Slow down.');
      expect(error.retryAt).toBeUndefined();
    }
  });

  it('uses the fallback message when the body is not JSON', async () => {
    const response = new Response('<html>502</html>', { status: 502 });

    const error = await httpErrorFrom(response, 'Failed to get upload URL');

    expect(error.status).toBe(502);
    expect(error.message).toBe('Failed to get upload URL');
  });
});

describe('comeBackAt', () => {
  const at = (h: number, m = 0, day = 22) => new Date(2026, 10, day, h, m);
  const hhmm = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  it('says the hour, the same day', () => {
    expect(comeBackAt(at(1), at(0, 30))).toBe(`You can try again after ${hhmm(at(1))}.`);
  });

  it('says tomorrow when the hour is on the next day', () => {
    expect(comeBackAt(at(19, 0, 23), at(20))).toBe(
      `You can try again tomorrow after ${hhmm(at(19))}.`
    );
  });

  it('says nothing for a wait of a minute or so', () => {
    expect(comeBackAt(at(12, 1), at(12))).toBeNull();
  });
});
