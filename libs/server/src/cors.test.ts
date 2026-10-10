import { describe, it, expect } from 'vitest';
import { mockRequest, mockResponse } from './test-utils';
import { applyCors } from './cors';

const headersSetOn = (res: ReturnType<typeof mockResponse>) =>
  Object.fromEntries(
    (res.setHeader as unknown as { mock: { calls: [string, string][] } }).mock.calls
  );

describe('applyCors', () => {
  it('lets the iOS shell read the answer', () => {
    const res = mockResponse();
    const done = applyCors(mockRequest({ headers: { origin: 'capacitor://localhost' } }), res);

    expect(done).toBe(false);
    expect(headersSetOn(res)['Access-Control-Allow-Origin']).toBe('capacitor://localhost');
    expect(headersSetOn(res)['Access-Control-Allow-Headers']).toContain('Authorization');
  });

  it('lets the Android shell read it too', () => {
    // androidScheme is 'https' in capacitor.config.ts. This test used to send
    // http://localhost — the same wrong guess the allowlist made, so the two
    // agreed with each other and not with the device.
    const res = mockResponse();
    applyCors(mockRequest({ headers: { origin: 'https://localhost' } }), res);

    expect(headersSetOn(res)['Access-Control-Allow-Origin']).toBe('https://localhost');
  });

  it('still answers a shell built with the older http scheme', () => {
    const res = mockResponse();
    applyCors(mockRequest({ headers: { origin: 'http://localhost' } }), res);

    expect(headersSetOn(res)['Access-Control-Allow-Origin']).toBe('http://localhost');
  });

  it('says nothing to an origin that is not on the list', () => {
    const res = mockResponse();
    const done = applyCors(mockRequest({ headers: { origin: 'https://evil.example' } }), res);

    expect(done).toBe(false);
    expect(headersSetOn(res)['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('says nothing when there is no Origin at all — the web app, calling itself', () => {
    const res = mockResponse();
    applyCors(mockRequest({ headers: {} }), res);

    expect(headersSetOn(res)['Access-Control-Allow-Origin']).toBeUndefined();
  });

  /* A cached response without the header would break the shell it was cached
     for, and one with it would hand a stranger an origin it never asked for. */
  it('varies on Origin either way', () => {
    const allowed = mockResponse();
    applyCors(mockRequest({ headers: { origin: 'capacitor://localhost' } }), allowed);
    expect(headersSetOn(allowed)['Vary']).toBe('Origin');

    const refused = mockResponse();
    applyCors(mockRequest({ headers: {} }), refused);
    expect(headersSetOn(refused)['Vary']).toBe('Origin');
  });

  /* The preflight carries no Authorization header, so a handler that went on
     to authenticate it would answer 401 and the real request would never be
     sent. It has to end here. */
  it('answers a preflight itself and tells the handler to stop', () => {
    const res = mockResponse();
    const done = applyCors(
      mockRequest({ method: 'OPTIONS', headers: { origin: 'capacitor://localhost' } }),
      res
    );

    expect(done).toBe(true);
    expect(res.statusCode).toBe(204);
    expect(headersSetOn(res)['Access-Control-Allow-Origin']).toBe('capacitor://localhost');
  });

  it('still ends a preflight from an origin it will not allow', () => {
    const res = mockResponse();
    const done = applyCors(mockRequest({ method: 'OPTIONS', headers: {} }), res);

    expect(done).toBe(true);
    expect(res.statusCode).toBe(204);
    expect(headersSetOn(res)['Access-Control-Allow-Origin']).toBeUndefined();
  });

  /* A shell is the app, somewhere else, and signs in. A reader is another
     site with no session to send: the public site, on the one route it
     reads. */
  describe('an origin a route names as a reader', () => {
    const SITE = 'https://site.example';

    it('may read the answer to a GET', () => {
      const res = mockResponse();
      const done = applyCors(mockRequest({ method: 'GET', headers: { origin: SITE } }), res, {
        readers: [SITE],
      });

      expect(done).toBe(false);
      expect(headersSetOn(res)['Access-Control-Allow-Origin']).toBe(SITE);
    });

    /* A request carrying a token or a JSON body is preflighted, and this is
       what the preflight is told: no header may be added, and no method but
       GET used. The browser then never sends the request itself. */
    it('is not told it may send a token, a body, or anything but a GET', () => {
      const res = mockResponse();
      const done = applyCors(mockRequest({ method: 'OPTIONS', headers: { origin: SITE } }), res, {
        readers: [SITE],
      });

      expect(done).toBe(true);
      expect(res.statusCode).toBe(204);
      expect(headersSetOn(res)['Access-Control-Allow-Headers']).toBeUndefined();
      expect(headersSetOn(res)['Access-Control-Allow-Methods']).toBe('GET, OPTIONS');
    });

    it('is a stranger to a route that does not name it', () => {
      const res = mockResponse();
      applyCors(mockRequest({ headers: { origin: SITE } }), res);

      expect(headersSetOn(res)['Access-Control-Allow-Origin']).toBeUndefined();
    });

    it('takes nothing from what a shell is given on the same route', () => {
      const res = mockResponse();
      applyCors(mockRequest({ headers: { origin: 'capacitor://localhost' } }), res, {
        readers: [SITE],
      });

      expect(headersSetOn(res)['Access-Control-Allow-Headers']).toContain('Authorization');
      expect(headersSetOn(res)['Access-Control-Allow-Methods']).toContain('DELETE');
    });
  });
});
