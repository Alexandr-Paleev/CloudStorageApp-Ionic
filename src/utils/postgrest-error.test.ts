import { describe, expect, it } from 'vitest';
import { isPostgrestError, messageOf } from './postgrest-error';
import { failedQuery, refused } from '../test/postgrest';

const RLS = 'new row violates row-level security policy for table "files"';

describe('a failed query, as supabase-js hands it over', () => {
  it('is the body PostgREST answered with, and not an Error', async () => {
    const error = await failedQuery(refused('42501', RLS, 403));

    expect(error).not.toBeInstanceOf(Error);
    expect(error).toEqual({ code: '42501', details: null, hint: null, message: RLS });
    expect(isPostgrestError(error)).toBe(true);
    expect(messageOf(error)).toBe(RLS);
  });

  it('has the same four fields when no answer came at all', async () => {
    const error = await failedQuery(() => Promise.reject(new TypeError('Failed to fetch')));

    expect(error).not.toBeInstanceOf(Error);
    expect(isPostgrestError(error)).toBe(true);
    expect(messageOf(error)).toBe('TypeError: Failed to fetch');
  });

  it('is not one when the body was not JSON, and a gateway page is no message', async () => {
    const page = '<html><body><h1>502 Bad Gateway</h1></body></html>';
    const error = await failedQuery(() => Promise.resolve(new Response(page, { status: 502 })));

    expect(error).toEqual({ message: page });
    expect(isPostgrestError(error)).toBe(false);
    expect(messageOf(error)).toBeUndefined();
  });
});

describe('messageOf', () => {
  it("reads an Error's message, with a code or without one", () => {
    const quota = Object.assign(new Error('Storage limit exceeded'), {
      code: 'PT413',
      details: null,
      hint: null,
    });

    expect(isPostgrestError(quota)).toBe(false);
    expect(messageOf(quota)).toBe('Storage limit exceeded');
  });

  it('has nothing to say for anything else', () => {
    const notFromPostgrest = { code: '42501', message: RLS };
    for (const value of [undefined, null, 'refused', 42, { code: '42501' }, notFromPostgrest]) {
      expect(messageOf(value)).toBeUndefined();
    }
  });
});
