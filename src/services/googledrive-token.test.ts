import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { expiryOf, forgetToken, readToken, rememberToken } from './googledrive-token';

const RECORD = { token: 'ya29.token', userId: 'user-1', expiresAt: 1_800_000_000_000 };

beforeEach(() => {
  localStorage.clear();
  forgetToken();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the stored Drive token', () => {
  it('comes back with its owner and its end', () => {
    rememberToken(RECORD);
    expect(readToken()).toEqual(RECORD);
  });

  it('is gone once forgotten', () => {
    rememberToken(RECORD);
    forgetToken();
    expect(readToken()).toBeNull();
  });

  /* The old key held a bare token: anyone's, of any age. */
  it('does not carry over a token stored before it had an owner', () => {
    localStorage.setItem('gdrive_access_token', 'ya29.old');

    expect(readToken()).toBeNull();
    expect(localStorage.getItem('gdrive_access_token')).toBeNull();
  });

  it('ignores a record that is not one', () => {
    localStorage.setItem('gdrive_token', JSON.stringify({ token: 'ya29.token' }));
    expect(readToken()).toBeNull();

    localStorage.setItem('gdrive_token', 'not json');
    expect(readToken()).toBeNull();
  });

  /* A browser with site data blocked throws on every call to storage. */
  it('keeps the token in memory where storage refuses it', () => {
    for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new Error('SecurityError');
      });
    }

    rememberToken(RECORD);
    expect(readToken()).toEqual(RECORD);

    forgetToken();
    expect(readToken()).toBeNull();
  });
});

describe('expiryOf', () => {
  it('ends a minute before Google says it does', () => {
    expect(expiryOf(3599, 0)).toBe(3_599_000 - 60_000);
  });

  it('takes the lifetime as a string too', () => {
    expect(expiryOf('3599', 0)).toBe(3_599_000 - 60_000);
  });

  it('assumes an hour when Google does not say', () => {
    expect(expiryOf(undefined, 0)).toBe(3_600_000 - 60_000);
    expect(expiryOf('soon', 0)).toBe(3_600_000 - 60_000);
  });
});
