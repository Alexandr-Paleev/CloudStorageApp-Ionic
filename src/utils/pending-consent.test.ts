import { describe, it, expect, beforeEach } from 'vitest';
import {
  CONSENT_PATH,
  afterSignIn,
  clearPendingConsent,
  isAuthorizationId,
  leavePendingConsent,
  pendingConsent,
} from './pending-consent';

beforeEach(() => sessionStorage.clear());

describe('an assistant’s sign-in waiting for the person to sign in (ADR 0020)', () => {
  it('leads a sign-in back to the consent page while one waits, and to the files after', () => {
    expect(afterSignIn()).toBe('/dashboard');

    leavePendingConsent('auth-1');
    expect(pendingConsent()).toBe('auth-1');
    expect(afterSignIn()).toBe(CONSENT_PATH);

    clearPendingConsent();
    expect(pendingConsent()).toBeNull();
    expect(afterSignIn()).toBe('/dashboard');
  });

  it('trusts nothing it did not keep in the shape of an id', () => {
    sessionStorage.setItem('pending-consent', '../user');
    expect(pendingConsent()).toBeNull();
    expect(afterSignIn()).toBe('/dashboard');
  });

  it('knows an id from anything else', () => {
    expect(isAuthorizationId('8f14e45f-ceea-467f-a0e6-1b2c3d4e5f60')).toBe(true);
    expect(isAuthorizationId('abc_DEF-123')).toBe(true);
    for (const value of ['', null, undefined, '../x', 'a b', 'a/b', 'a'.repeat(129)]) {
      expect(isAuthorizationId(value)).toBe(false);
    }
  });
});
