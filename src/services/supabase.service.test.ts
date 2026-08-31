import { describe, it, expect, beforeEach, vi } from 'vitest';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock('../supabase/supabase.config', () => ({ supabase: { from } }));
vi.mock('../observability/sentry', () => ({ captureException: vi.fn() }));

import supabaseService from './supabase.service';

/** Mimics the one chain this function uses: select → eq → maybeSingle. */
function answers(result: { data?: unknown; error?: unknown }) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => result),
  };
  from.mockReturnValue(chain);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getTotalStorageUsed', () => {
  it('reads one profile row rather than walking the files table', async () => {
    // This is called before every upload, and used to page through every row
    // the user owns — while the API did the same walk again on its side.
    const chain = answers({ data: { bytes_used: 1234 }, error: null });

    await expect(supabaseService.getTotalStorageUsed('user-1')).resolves.toBe(1234);
    expect(from).toHaveBeenCalledExactlyOnceWith('profiles');
    expect(chain.select).toHaveBeenCalledWith('bytes_used');
  });

  it('treats an account with no profile row as empty', async () => {
    answers({ data: null, error: null });

    await expect(supabaseService.getTotalStorageUsed('user-1')).resolves.toBe(0);
  });

  it('throws instead of reporting zero when the read fails', async () => {
    // Zero would read as "plenty of room" and wave the upload through.
    answers({ data: null, error: { message: 'connection reset' } });

    await expect(supabaseService.getTotalStorageUsed('user-1')).rejects.toMatchObject({
      message: 'connection reset',
    });
  });
});
