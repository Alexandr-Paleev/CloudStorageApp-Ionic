import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eraseAccount } from './account-erase';

const USER = 'user-1';

function makeSupabase(overrides: Record<string, unknown> = {}) {
  const removed: string[][] = [];
  const deletedFrom: string[] = [];

  const storage = {
    list: vi.fn().mockResolvedValue({ data: [{ name: 'a.txt' }, { name: 'b.txt' }], error: null }),
    remove: vi.fn(async (paths: string[]) => {
      removed.push(paths);
      storage.list.mockResolvedValue({ data: [], error: null });
      return { error: null };
    }),
  };

  const client = {
    storage: { from: vi.fn(() => storage) },
    from: vi.fn((table: string) => ({
      delete: () => ({
        eq: vi.fn(async () => {
          deletedFrom.push(table);
          return { error: null };
        }),
      }),
    })),
    auth: { admin: { deleteUser: vi.fn(async () => ({ error: null })) } },
    ...overrides,
  };

  return { client, storage, removed, deletedFrom };
}

describe('eraseAccount', () => {
  let s: ReturnType<typeof makeSupabase>;

  beforeEach(() => {
    s = makeSupabase();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('removes the stored objects, the rows and then the user', async () => {
    await eraseAccount(USER, { supabase: s.client as never });

    expect(s.removed).toEqual([[`${USER}/a.txt`, `${USER}/b.txt`]]);
    expect(s.deletedFrom).toEqual(['files', 'folders']);
    expect(s.client.auth.admin.deleteUser).toHaveBeenCalledWith(USER);
  });

  /* files.user_id and folders.user_id have no foreign key to auth.users, so
     deleting the user first strands every row it owns — silently. */
  it('deletes the rows before the user, not after', async () => {
    const order: string[] = [];
    const client = {
      ...s.client,
      from: vi.fn((table: string) => ({
        delete: () => ({
          eq: vi.fn(async () => {
            order.push(table);
            return { error: null };
          }),
        }),
      })),
      auth: {
        admin: {
          deleteUser: vi.fn(async () => {
            order.push('user');
            return { error: null };
          }),
        },
      },
    };

    await eraseAccount(USER, { supabase: client as never });
    expect(order).toEqual(['files', 'folders', 'user']);
  });

  it('erases every configured provider', async () => {
    const eraseR2 = vi.fn().mockResolvedValue(undefined);
    const eraseCloudinary = vi.fn().mockResolvedValue(undefined);

    const { failures } = await eraseAccount(USER, {
      supabase: s.client as never,
      eraseR2,
      eraseCloudinary,
    });

    expect(eraseR2).toHaveBeenCalledWith(USER);
    expect(eraseCloudinary).toHaveBeenCalledWith(USER);
    expect(failures).toEqual([]);
  });

  /* A person who has asked to be deleted must not be left with an account
     because one bucket was briefly unreachable. */
  it('still deletes the account when a provider fails, and reports which', async () => {
    const eraseR2 = vi.fn().mockRejectedValue(new Error('bucket unreachable'));

    const { failures } = await eraseAccount(USER, { supabase: s.client as never, eraseR2 });

    expect(failures).toEqual(['r2']);
    expect(s.deletedFrom).toEqual(['files', 'folders']);
    expect(s.client.auth.admin.deleteUser).toHaveBeenCalledWith(USER);
  });

  /* The opposite case: failing to delete the user is the request not being
     honoured at all, and must not be reported as success. */
  it('throws when the user itself cannot be deleted', async () => {
    const client = {
      ...s.client,
      auth: { admin: { deleteUser: vi.fn(async () => ({ error: { message: 'nope' } })) } },
    };

    await expect(eraseAccount(USER, { supabase: client as never })).rejects.toThrow(
      /Failed to delete the account: nope/
    );
  });

  it('keeps listing until a page comes back short', async () => {
    const pages = [
      { data: Array.from({ length: 100 }, (_, i) => ({ name: `f${i}` })), error: null },
      { data: [{ name: 'last' }], error: null },
    ];
    s.storage.list.mockImplementation(async () => pages.shift() ?? { data: [], error: null });
    s.storage.remove.mockImplementation(async (paths: string[]) => {
      s.removed.push(paths);
      return { error: null };
    });

    await eraseAccount(USER, { supabase: s.client as never });

    expect(s.removed).toHaveLength(2);
    expect(s.removed[1]).toEqual([`${USER}/last`]);
  });
});
