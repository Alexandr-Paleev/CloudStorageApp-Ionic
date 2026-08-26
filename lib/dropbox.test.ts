import { describe, it, expect } from 'vitest';
import { assertSameOrigin } from './dropbox';

const APP = 'https://cloud-storage-app-ionic-v0.vercel.app';

describe('assertSameOrigin', () => {
  it('accepts a redirect back to this deployment', () => {
    expect(() => assertSameOrigin(`${APP}/dropbox/callback`, APP)).not.toThrow();
    expect(() => assertSameOrigin(`${APP}/dropbox/callback?x=1`, APP)).not.toThrow();
  });

  it('refuses a redirect to somebody else', () => {
    expect(() => assertSameOrigin('https://evil.example/steal', APP)).toThrow(
      /does not belong to this deployment/
    );
  });

  it('refuses a look-alike host', () => {
    // Prefix match would let this through; origin comparison does not.
    expect(() => assertSameOrigin(`${APP}.evil.example/cb`, APP)).toThrow();
    expect(() => assertSameOrigin('https://evil.example/?x=' + APP, APP)).toThrow();
  });

  it('refuses a different scheme or port on the same host', () => {
    expect(() => assertSameOrigin('http://localhost:8100/cb', 'https://localhost:8100')).toThrow();
    expect(() => assertSameOrigin('http://localhost:9999/cb', 'http://localhost:8100')).toThrow();
  });

  it('rejects something that is not a URL at all', () => {
    expect(() => assertSameOrigin('/dropbox/callback', APP)).toThrow(/not a valid URL/);
    expect(() => assertSameOrigin('javascript:alert(1)', APP)).toThrow();
  });
});
