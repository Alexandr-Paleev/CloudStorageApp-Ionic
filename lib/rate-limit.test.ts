import { describe, it, expect } from 'vitest';
import { mockResponse } from './test-utils';
import { RateLimiter, clientIp, resetRateLimits, tooManyRequests } from './rate-limit';

describe('RateLimiter', () => {
  it('allows up to the limit and then refuses', () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.allow('a', 0)).toBe(true);
    expect(limiter.allow('a', 1)).toBe(true);
    expect(limiter.allow('a', 2)).toBe(false);
  });

  it('counts each caller separately', () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.allow('a', 0)).toBe(true);
    expect(limiter.allow('b', 0)).toBe(true);
    expect(limiter.allow('a', 0)).toBe(false);
  });

  it('forgets hits once the window has passed', () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.allow('a', 0)).toBe(true);
    expect(limiter.allow('a', 500)).toBe(false);
    expect(limiter.allow('a', 1001)).toBe(true);
  });

  it('drops keys that have gone quiet instead of growing forever', () => {
    const limiter = new RateLimiter(1, 1000);
    limiter.allow('gone', 0);
    limiter.allow('here', 2000);
    // 'gone' has aged out, so its limit starts clean rather than remembered.
    expect(limiter.allow('gone', 2000)).toBe(true);
  });

  it('does not spend a hit on the request it refuses', () => {
    // Otherwise a client that keeps retrying keeps pushing its own window
    // forward and is locked out for as long as it keeps asking.
    const limiter = new RateLimiter(1, 1000);
    limiter.allow('a', 0);
    limiter.allow('a', 900);
    expect(limiter.allow('a', 1001)).toBe(true);
  });
});

describe('RateLimiter.retryAfterSeconds', () => {
  it('counts to the moment the oldest hit leaves the window', () => {
    const limiter = new RateLimiter(1, 60_000);
    limiter.allow('a', 0);
    expect(limiter.retryAfterSeconds('a', 10_000)).toBe(50);
  });

  it('never answers zero', () => {
    // A client told to retry after 0 seconds retries at once and is refused
    // again — the round trip the limit is there to prevent.
    const limiter = new RateLimiter(1, 1000);
    limiter.allow('a', 0);
    expect(limiter.retryAfterSeconds('a', 999)).toBe(1);
  });

  it('rounds up, so the retry lands after the window rather than on it', () => {
    const limiter = new RateLimiter(1, 60_000);
    limiter.allow('a', 0);
    expect(limiter.retryAfterSeconds('a', 59_500)).toBe(1);
  });

  it('is zero for a caller that has not been seen', () => {
    expect(new RateLimiter(1, 1000).retryAfterSeconds('nobody', 0)).toBe(0);
  });
});

describe('resetRateLimits', () => {
  it('clears every limiter, so a spent limit does not leak into the next test', () => {
    const a = new RateLimiter(1, 60_000);
    const b = new RateLimiter(1, 60_000);
    a.allow('k', 0);
    b.allow('k', 0);

    resetRateLimits();

    expect(a.allow('k', 0)).toBe(true);
    expect(b.allow('k', 0)).toBe(true);
  });
});

describe('tooManyRequests', () => {
  it('answers 429 with the message', () => {
    const res = mockResponse();
    tooManyRequests(res, 30, 'Slow down');

    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ message: 'Slow down' });
  });

  it('says when to come back', () => {
    const res = mockResponse();
    tooManyRequests(res, 30, 'Slow down');

    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '30');
  });
});

describe('clientIp', () => {
  it('takes the original client from a proxy chain', () => {
    expect(clientIp({ 'x-forwarded-for': '203.0.113.9, 70.41.3.18' })).toBe('203.0.113.9');
  });

  it('handles the header arriving as an array', () => {
    expect(clientIp({ 'x-forwarded-for': ['203.0.113.9'] })).toBe('203.0.113.9');
  });

  it('prefers x-forwarded-for over x-real-ip', () => {
    expect(clientIp({ 'x-forwarded-for': '203.0.113.9', 'x-real-ip': '198.51.100.4' })).toBe(
      '203.0.113.9'
    );
  });

  it('accepts x-real-ip where only that is set', () => {
    expect(clientIp({ 'x-real-ip': '198.51.100.4' })).toBe('198.51.100.4');
  });

  /* Without this the dev server put every caller in one bucket, and the suite
     locked itself out of the route on its fifth run. */
  it('falls back to the socket address when no proxy header is set', () => {
    expect(clientIp({}, '::ffff:127.0.0.1')).toBe('::ffff:127.0.0.1');
  });

  it('falls back to a single bucket only when nothing identifies the caller', () => {
    expect(clientIp({})).toBe('unknown');
  });
});
