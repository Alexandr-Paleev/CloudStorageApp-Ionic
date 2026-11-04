import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BillingNotClosed, eraseAccount } from './account-erase';

const USER = 'user-1';

/** What `profiles` answers for the account: by default, one that never opened
 *  a checkout. */
function profileTable(
  answer: { data: unknown[] | null; error: unknown } = {
    data: [{ stripe_customer_id: null }],
    error: null,
  }
) {
  return { select: () => ({ eq: () => ({ limit: async () => answer }) }) };
}

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
    from: vi.fn((table: string) =>
      table === 'profiles'
        ? profileTable()
        : {
            delete: () => ({
              eq: vi.fn(async () => {
                deletedFrom.push(table);
                return { error: null };
              }),
            }),
          }
    ),
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
      from: vi.fn((table: string) =>
        table === 'profiles'
          ? profileTable()
          : {
              delete: () => ({
                eq: vi.fn(async () => {
                  order.push(table);
                  return { error: null };
                }),
              }),
            }
      ),
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

/* Closing the Stripe customer lived in DELETE /api/account alone, and the
   demo sweep, the other caller of this erase, left the customers of the
   accounts it erased behind. */
describe('what the account pays for', () => {
  function payingAccount(customer = 'cus_123') {
    const s = makeSupabase();
    const from = s.client.from;
    s.client.from = vi.fn((table: string) =>
      table === 'profiles'
        ? profileTable({ data: [{ stripe_customer_id: customer }], error: null })
        : from(table)
    ) as typeof s.client.from;
    return s;
  }

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('is closed before anything is erased', async () => {
    const s = payingAccount('cus_123');
    const closeBilling = vi.fn().mockResolvedValue(undefined);

    await eraseAccount(USER, { supabase: s.client as never, closeBilling });

    expect(closeBilling).toHaveBeenCalledWith('cus_123');
    expect(closeBilling.mock.invocationCallOrder[0]!).toBeLessThan(
      s.storage.list.mock.invocationCallOrder[0]!
    );
    expect(s.client.auth.admin.deleteUser).toHaveBeenCalledWith(USER);
  });

  it('stops the erase, with nothing erased, when Stripe would not close it', async () => {
    const s = payingAccount();
    const refusal = new BillingNotClosed('nothing was deleted', 502);
    const closeBilling = vi.fn().mockRejectedValue(refusal);

    await expect(eraseAccount(USER, { supabase: s.client as never, closeBilling })).rejects.toBe(
      refusal
    );

    expect(s.storage.list).not.toHaveBeenCalled();
    expect(s.deletedFrom).toEqual([]);
    expect(s.client.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  /* The subscription goes on renewing whether or not this deployment holds
     the key that could end it. */
  it('stops the erase when there is a customer and no way to close it', async () => {
    const s = payingAccount();

    const refusal = await eraseAccount(USER, { supabase: s.client as never }).catch(
      (error: unknown) => error
    );

    expect(refusal).toBeInstanceOf(BillingNotClosed);
    expect(refusal).toMatchObject({ status: 503 });
    expect(s.storage.list).not.toHaveBeenCalled();
    expect(s.client.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it('asks nothing of Stripe for an account that never opened a checkout', async () => {
    const s = makeSupabase();
    const closeBilling = vi.fn();

    await eraseAccount(USER, { supabase: s.client as never, closeBilling });

    expect(closeBilling).not.toHaveBeenCalled();
  });

  it('erases nothing when the profile cannot be read', async () => {
    const s = makeSupabase();
    s.client.from = vi.fn(() =>
      profileTable({ data: null, error: { message: 'connection reset' } })
    ) as typeof s.client.from;

    await expect(eraseAccount(USER, { supabase: s.client as never })).rejects.toThrow(
      /Failed to read the profile: connection reset/
    );
    expect(s.storage.list).not.toHaveBeenCalled();
  });
});

/* Storage lists one level at a time. The erase listed the account's folder
   alone, so anything deeper outlived the account, and a page of folders,
   which `remove` cannot remove, was listed again and again until the
   function timed out. */
describe('folders inside the account\u2019s folder', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('are emptied too, whatever their depth', async () => {
    const s = makeSupabase();
    const tree: Record<string, { name: string; id: string | null }[]> = {
      [USER]: [
        { name: 'deep', id: null },
        { name: 'top.txt', id: 'o1' },
      ],
      [`${USER}/deep`]: [
        { name: 'deeper', id: null },
        { name: 'mid.txt', id: 'o2' },
      ],
      [`${USER}/deep/deeper`]: [{ name: 'bottom.txt', id: 'o3' }],
    };
    s.storage.list.mockImplementation(async (folder: string) => ({
      data: tree[folder] ?? [],
      error: null,
    }));
    s.storage.remove.mockImplementation(async (paths: string[]) => {
      s.removed.push(paths);
      for (const path of paths) {
        const folder = path.slice(0, path.lastIndexOf('/'));
        tree[folder] = (tree[folder] ?? []).filter((e) => `${folder}/${e.name}` !== path);
        // A folder is only a prefix: with nothing left under it, it is gone.
        if (tree[folder]?.length === 0) {
          const parent = folder.slice(0, folder.lastIndexOf('/'));
          const name = folder.slice(folder.lastIndexOf('/') + 1);
          if (tree[parent]) tree[parent] = tree[parent].filter((e) => e.name !== name);
        }
      }
      return { error: null };
    });

    const { failures } = await eraseAccount(USER, { supabase: s.client as never });

    expect(failures).toEqual([]);
    expect(s.removed.flat().sort()).toEqual([
      `${USER}/deep/deeper/bottom.txt`,
      `${USER}/deep/mid.txt`,
      `${USER}/top.txt`,
    ]);
  });

  it('give up, and say so, when a pass removes nothing', async () => {
    const s = makeSupabase();
    const page = Array.from({ length: 100 }, (_, i) => ({ name: `f${i}`, id: `o${i}` }));
    s.storage.list.mockResolvedValue({ data: page, error: null });
    s.storage.remove.mockResolvedValue({ error: null });

    const { failures } = await eraseAccount(USER, { supabase: s.client as never });

    expect(failures).toEqual(['supabase_storage']);
    expect(s.storage.list).toHaveBeenCalledTimes(2);
    // The account still goes: a bucket that will not empty is reported, not
    // a reason to keep someone who asked to be deleted.
    expect(s.client.auth.admin.deleteUser).toHaveBeenCalledWith(USER);
  });
});
