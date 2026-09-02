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

describe('getFiles: the query the dashboard asks for', () => {
  /** The chain getFiles walks, ending on .order(), which it awaits. */
  function listing(rows: unknown[] = []) {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      is: vi.fn(() => chain),
      ilike: vi.fn(() => chain),
      or: vi.fn(() => chain),
      not: vi.fn(() => chain),
      range: vi.fn(() => chain),
      order: vi.fn(async () => ({ data: rows, error: null })),
    };
    from.mockReturnValue(chain);
    return chain;
  }

  it('lists the root when no folder is named', async () => {
    const chain = listing();
    await supabaseService.getFiles('user-1');

    expect(chain.is).toHaveBeenCalledWith('folder_id', null);
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-1');
  });

  it('lists one folder when it is', async () => {
    const chain = listing();
    await supabaseService.getFiles('user-1', { folderId: 'folder-1' });

    expect(chain.eq).toHaveBeenCalledWith('folder_id', 'folder-1');
    expect(chain.is).not.toHaveBeenCalled();
  });

  it('drops the folder filter while searching', async () => {
    // The whole point of searching: a file two folders away still counts.
    const chain = listing();
    await supabaseService.getFiles('user-1', { folderId: 'folder-1', search: 'invoice' });

    expect(chain.eq).not.toHaveBeenCalledWith('folder_id', 'folder-1');
    expect(chain.is).not.toHaveBeenCalled();
  });

  it('matches the name anywhere in it, case-insensitively', async () => {
    const chain = listing();
    await supabaseService.getFiles('user-1', { search: 'Invoice' });

    expect(chain.ilike).toHaveBeenCalledWith('name', '%Invoice%');
  });

  it('escapes the wildcards a person can type by accident', async () => {
    // Without this, searching for report_final also finds reportXfinal, and
    // searching for "50%" finds everything.
    const chain = listing();
    await supabaseService.getFiles('user-1', { search: 'report_50%' });

    expect(chain.ilike).toHaveBeenCalledWith('name', '%report\\_50\\%%');
  });

  it('ignores a search that is only whitespace', async () => {
    const chain = listing();
    await supabaseService.getFiles('user-1', { search: '   ' });

    expect(chain.ilike).not.toHaveBeenCalled();
    expect(chain.is).toHaveBeenCalledWith('folder_id', null);
  });

  it('filters images by MIME prefix', async () => {
    const chain = listing();
    await supabaseService.getFiles('user-1', { group: 'images' });

    expect(chain.ilike).toHaveBeenCalledWith('type', 'image/%');
  });

  it('treats application/ and text/ as documents', async () => {
    const chain = listing();
    await supabaseService.getFiles('user-1', { group: 'documents' });

    expect(chain.or).toHaveBeenCalledWith('type.ilike.application/%,type.ilike.text/%');
  });

  it('builds "other" by refusing the other two groups', async () => {
    // PostgREST has no "none of these", so each prefix is refused in turn.
    const chain = listing();
    await supabaseService.getFiles('user-1', { group: 'other' });

    expect(chain.not.mock.calls).toEqual([
      ['type', 'ilike', 'image/%'],
      ['type', 'ilike', 'application/%'],
      ['type', 'ilike', 'text/%'],
    ]);
  });

  it('asks for no type filter at all by default', async () => {
    const chain = listing();
    await supabaseService.getFiles('user-1');

    expect(chain.ilike).not.toHaveBeenCalled();
    expect(chain.or).not.toHaveBeenCalled();
    expect(chain.not).not.toHaveBeenCalled();
  });

  it('sorts newest first unless told otherwise', async () => {
    const chain = listing();
    await supabaseService.getFiles('user-1');

    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  it.each([
    ['name', 'asc', true],
    ['size', 'desc', false],
  ] as const)('sorts by %s %s', async (sort, direction, ascending) => {
    const chain = listing();
    await supabaseService.getFiles('user-1', { sort, direction });

    expect(chain.order).toHaveBeenCalledWith(sort, { ascending });
  });

  it('asks for one page at a time', async () => {
    const chain = listing();
    await supabaseService.getFiles('user-1', { page: 2, pageSize: 15 });

    expect(chain.range).toHaveBeenCalledWith(30, 44);
  });

  it('asks for everything when no page is named', async () => {
    const chain = listing();
    await supabaseService.getFiles('user-1');

    expect(chain.range).not.toHaveBeenCalled();
  });
});

describe('getFolderPath', () => {
  /** Every folder the account owns, which is what the walk reads. */
  function folders(rows: { id: string; name: string; parent_id: string | null }[]) {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(async () => ({ data: rows, error: null })),
    };
    from.mockReturnValue(chain);
    return chain;
  }

  const tree = [
    { id: 'a', name: 'Work', parent_id: null },
    { id: 'b', name: 'Invoices', parent_id: 'a' },
    { id: 'c', name: '2024', parent_id: 'b' },
    { id: 'x', name: 'Photos', parent_id: null },
  ];

  it('reads every folder once rather than once per level', async () => {
    // One query, walked here: a breadcrumb bar that cost a round trip per
    // ancestor would be slowest at exactly the depth that needs it.
    const chain = folders(tree);
    await supabaseService.getFolderPath('c', 'user-1');

    expect(from).toHaveBeenCalledExactlyOnceWith('folders');
    expect(chain.select).toHaveBeenCalledTimes(1);
  });

  it('returns the chain root first', async () => {
    folders(tree);
    const path = await supabaseService.getFolderPath('c', 'user-1');

    expect(path.map((f) => f.name)).toEqual(['Work', 'Invoices', '2024']);
  });

  it('returns a single entry for a folder at the root', async () => {
    folders(tree);
    const path = await supabaseService.getFolderPath('x', 'user-1');

    expect(path.map((f) => f.name)).toEqual(['Photos']);
  });

  it('returns nothing for a folder that is not there', async () => {
    folders(tree);
    await expect(supabaseService.getFolderPath('gone', 'user-1')).resolves.toEqual([]);
  });

  it('stops instead of looping when parents point at each other', async () => {
    // Nothing in the schema forbids it, and a breadcrumb bar is a poor place
    // to find out: without the guard this never returns.
    folders([
      { id: 'p', name: 'One', parent_id: 'q' },
      { id: 'q', name: 'Two', parent_id: 'p' },
    ]);

    const path = await supabaseService.getFolderPath('p', 'user-1');
    expect(path).toHaveLength(2);
  });
});
