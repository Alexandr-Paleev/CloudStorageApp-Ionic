import { describe, it, expect, beforeEach, vi } from 'vitest';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock('../supabase/supabase.config', () => ({ supabase: { from } }));
vi.mock('../observability/sentry', () => ({ captureException: vi.fn() }));

import supabaseService from './supabase.service';
import * as Sentry from '../observability/sentry';

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

describe('saveFileMetadata', () => {
  function insertFails(error: unknown) {
    const chain = {
      insert: vi.fn(() => chain),
      select: vi.fn(() => chain),
      single: vi.fn(async () => ({ data: null, error })),
    };
    from.mockReturnValue(chain);
  }

  const row = {
    name: 'report.pdf',
    size: 1024,
    type: 'application/pdf',
    download_url: 'https://example.invalid/x',
    storage_path: 'user-1/report.pdf',
    storage_type: 'r2' as const,
    user_id: 'user-1',
  };

  it('does not report a full account to Sentry', async () => {
    // The caller turns PT413 into a sentence the user can act on. Reporting it
    // here as well is what made that skip ineffective: every user running out
    // of space showed up as an exception.
    insertFails(Object.assign(new Error('Storage limit exceeded'), { code: 'PT413' }));

    await expect(supabaseService.saveFileMetadata(row)).rejects.toThrow(/Storage limit exceeded/);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('still reports a failure nobody expected', async () => {
    insertFails(Object.assign(new Error('connection reset'), { code: '08006' }));

    await expect(supabaseService.saveFileMetadata(row)).rejects.toThrow(/connection reset/);
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});
