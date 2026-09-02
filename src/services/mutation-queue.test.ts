import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MAX_ATTEMPTS,
  RequestTimeout,
  applyPending,
  withDeadline,
  coalesce,
  flushQueue,
  looksOffline,
  targetOf,
  type MutationStore,
  type PendingOp,
  type QueuedMutation,
} from './mutation-queue';

let clock = 1_000;
const queued = (op: PendingOp, overrides: Partial<QueuedMutation> = {}): QueuedMutation => ({
  id: `q${clock}`,
  op,
  createdAt: clock++,
  attempts: 0,
  ...overrides,
});

/** The store, in memory — same contract, none of the IndexedDB. */
function fakeStore(entries: QueuedMutation[] = []) {
  let rows = [...entries];
  const store: MutationStore = {
    async add(op) {
      const entry = queued(op);
      rows.push(entry);
      return entry;
    },
    async list() {
      return [...rows].sort((a, b) => a.createdAt - b.createdAt);
    },
    async save(entry) {
      rows = rows.map((row) => (row.id === entry.id ? entry : row));
    },
    async remove(id) {
      rows = rows.filter((row) => row.id !== id);
    },
  };
  return { store, rows: () => rows };
}

beforeEach(() => {
  clock = 1_000;
});

describe('targetOf', () => {
  it('names the row an operation acts on', () => {
    expect(targetOf({ kind: 'renameFile', fileId: 'f1', name: 'a' })).toBe('file:f1');
    expect(targetOf({ kind: 'deleteFolder', folderId: 'd1' })).toBe('folder:d1');
  });

  it('does not confuse a file with a folder that shares its id', () => {
    expect(targetOf({ kind: 'deleteFile', fileId: 'x' })).not.toBe(
      targetOf({ kind: 'deleteFolder', folderId: 'x' })
    );
  });
});

describe('coalesce', () => {
  it('keeps unrelated operations, in order', () => {
    const ops = [
      queued({ kind: 'renameFile', fileId: 'f1', name: 'a' }),
      queued({ kind: 'deleteFile', fileId: 'f2' }),
    ];
    expect(coalesce(ops)).toHaveLength(2);
  });

  it('keeps only the last of several renames of one file', () => {
    // Three renames offline are one rename; replaying each is three round
    // trips for a decision the user has already changed their mind about.
    const ops = [
      queued({ kind: 'renameFile', fileId: 'f1', name: 'first' }),
      queued({ kind: 'renameFile', fileId: 'f1', name: 'second' }),
      queued({ kind: 'renameFile', fileId: 'f1', name: 'third' }),
    ];

    const result = coalesce(ops);
    expect(result).toHaveLength(1);
    expect((result[0].op as { name: string }).name).toBe('third');
  });

  it('drops a rename that a deletion made pointless', () => {
    const ops = [
      queued({ kind: 'renameFile', fileId: 'f1', name: 'new name' }),
      queued({ kind: 'deleteFile', fileId: 'f1' }),
    ];

    const result = coalesce(ops);
    expect(result).toHaveLength(1);
    expect(result[0].op.kind).toBe('deleteFile');
  });

  it('ignores a rename queued after a deletion', () => {
    // Nothing in the interface offers this, but the queue survives reloads and
    // a stale screen can.
    const ops = [
      queued({ kind: 'deleteFile', fileId: 'f1' }),
      queued({ kind: 'renameFile', fileId: 'f1', name: 'ghost' }),
    ];

    expect(coalesce(ops).map((e) => e.op.kind)).toEqual(['deleteFile']);
  });

  it('treats folders the same way', () => {
    const ops = [
      queued({ kind: 'renameFolder', folderId: 'd1', name: 'one' }),
      queued({ kind: 'renameFolder', folderId: 'd1', name: 'two' }),
      queued({ kind: 'deleteFolder', folderId: 'd2' }),
    ];

    expect(coalesce(ops)).toHaveLength(2);
  });
});

describe('looksOffline', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('trusts the browser when it says the network is gone', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(looksOffline(new Error('anything at all'))).toBe(true);
  });

  it.each([
    ['Failed to fetch', true],
    ['NetworkError when attempting to fetch resource', true],
    ['connection reset', true],
    ['File not found or access denied', false],
    ['Storage limit exceeded', false],
  ])('%s -> %s', (message, expected) => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(looksOffline(new Error(message))).toBe(expected);
  });

  it('treats the TypeError fetch throws as a network failure', () => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(looksOffline(new TypeError('Load failed'))).toBe(true);
  });

  it('recognises the plain object supabase-js throws, not only real Errors', () => {
    // This is the shape a failed Supabase request actually arrives in, and it
    // matters most in the case the browser thinks it is online: a captive
    // portal, a dropped VPN, a host that stopped answering.
    vi.stubGlobal('navigator', { onLine: true });
    expect(looksOffline({ message: 'TypeError: Failed to fetch (db.supabase.co)' })).toBe(true);
  });

  it('still refuses to call a real refusal a network problem', () => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(looksOffline({ message: 'File not found or access denied' })).toBe(false);
  });
});

describe('flushQueue', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { onLine: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends what is waiting, oldest first', async () => {
    const { store, rows } = fakeStore([
      queued({ kind: 'renameFile', fileId: 'f1', name: 'a' }),
      queued({ kind: 'deleteFile', fileId: 'f2' }),
    ]);
    const seen: string[] = [];

    const result = await flushQueue(async (op) => {
      seen.push(op.kind);
    }, store);

    expect(seen).toEqual(['renameFile', 'deleteFile']);
    expect(result).toMatchObject({ sent: 2, failed: 0, remaining: 0 });
    expect(rows()).toHaveLength(0);
  });

  it('coalesces before sending, not after', async () => {
    const { store } = fakeStore([
      queued({ kind: 'renameFile', fileId: 'f1', name: 'first' }),
      queued({ kind: 'renameFile', fileId: 'f1', name: 'second' }),
    ]);
    const names: string[] = [];

    await flushQueue(async (op) => {
      names.push((op as { name: string }).name);
    }, store);

    expect(names).toEqual(['second']);
  });

  it('stops at the first sign the network is still gone', async () => {
    // Walking the rest of the queue into the same wall costs time and burns
    // an attempt on every entry.
    const { store, rows } = fakeStore([
      queued({ kind: 'deleteFile', fileId: 'f1' }),
      queued({ kind: 'deleteFile', fileId: 'f2' }),
      queued({ kind: 'deleteFile', fileId: 'f3' }),
    ]);
    let calls = 0;

    const result = await flushQueue(async () => {
      calls += 1;
      if (calls === 2) throw new TypeError('Failed to fetch');
    }, store);

    expect(calls).toBe(2);
    expect(result.sent).toBe(1);
    expect(rows()).toHaveLength(2);
  });

  it('keeps a change the server refused, and counts the attempt', async () => {
    const { store, rows } = fakeStore([queued({ kind: 'deleteFile', fileId: 'f1' })]);

    await flushQueue(async () => {
      throw new Error('File not found or access denied');
    }, store);

    expect(rows()[0]).toMatchObject({ attempts: 1, lastError: 'File not found or access denied' });
  });

  it('gives up on it eventually, so it cannot block the queue forever', async () => {
    const { store, rows } = fakeStore([
      queued({ kind: 'deleteFile', fileId: 'f1' }, { attempts: MAX_ATTEMPTS - 1 }),
    ]);

    const result = await flushQueue(async () => {
      throw new Error('File not found or access denied');
    }, store);

    expect(result.failed).toBe(1);
    expect(rows()).toHaveLength(0);
  });

  it('carries on past a refusal to the changes behind it', async () => {
    const { store } = fakeStore([
      queued({ kind: 'deleteFile', fileId: 'gone' }),
      queued({ kind: 'renameFile', fileId: 'f2', name: 'fine' }),
    ]);
    const sent: string[] = [];

    const result = await flushQueue(async (op) => {
      if (op.kind === 'deleteFile') throw new Error('File not found or access denied');
      sent.push(op.kind);
    }, store);

    expect(sent).toEqual(['renameFile']);
    expect(result.sent).toBe(1);
  });

  it('does nothing, cheerfully, when there is nothing queued', async () => {
    const { store } = fakeStore([]);
    const perform = vi.fn();

    await expect(flushQueue(perform, store)).resolves.toEqual({
      sent: 0,
      failed: 0,
      remaining: 0,
    });
    expect(perform).not.toHaveBeenCalled();
  });
});

describe('withDeadline', () => {
  it('passes a prompt answer straight through', async () => {
    await expect(withDeadline(Promise.resolve('done'), 50)).resolves.toBe('done');
  });

  it('passes a prompt failure through unchanged', async () => {
    await expect(withDeadline(Promise.reject(new Error('refused')), 50)).rejects.toThrow('refused');
  });

  it('gives up on a request that never answers', async () => {
    // The case this exists for: with no network, supabase-js can wait on a
    // token refresh that will never happen and the promise never settles at
    // all — there is no failure to catch, only silence.
    await expect(withDeadline(new Promise(() => {}), 20)).rejects.toBeInstanceOf(RequestTimeout);
  });

  it('counts as a network problem, so the change is kept rather than lost', () => {
    expect(looksOffline(new RequestTimeout())).toBe(true);
  });
});

describe('applyPending', () => {
  const listing = () => ({
    files: [
      { id: 'f1', name: 'a.pdf' },
      { id: 'f2', name: 'b.pdf' },
    ],
    folders: [{ id: 'd1', name: 'Work' }],
  });

  it('hides a file queued for deletion', () => {
    const result = applyPending(listing(), [{ kind: 'deleteFile', fileId: 'f1' }]);
    expect(result.files.map((f) => f.id)).toEqual(['f2']);
  });

  it('shows the new name of a file queued for renaming', () => {
    const result = applyPending(listing(), [{ kind: 'renameFile', fileId: 'f2', name: 'new.pdf' }]);
    expect(result.files.find((f) => f.id === 'f2')?.name).toBe('new.pdf');
  });

  it('hides a folder queued for deletion', () => {
    const result = applyPending(listing(), [{ kind: 'deleteFolder', folderId: 'd1' }]);
    expect(result.folders).toHaveLength(0);
  });

  it('applies several changes in order', () => {
    const result = applyPending(listing(), [
      { kind: 'renameFile', fileId: 'f1', name: 'renamed.pdf' },
      { kind: 'deleteFile', fileId: 'f2' },
    ]);

    expect(result.files).toEqual([{ id: 'f1', name: 'renamed.pdf' }]);
  });

  it('leaves the listing alone when nothing is queued', () => {
    const before = listing();
    expect(applyPending(before, [])).toEqual(before);
  });

  it('ignores an operation about a row this listing does not hold', () => {
    // Deleting from inside a folder, seen from the root: the queue is global,
    // the listing is not.
    const before = listing();
    expect(applyPending(before, [{ kind: 'deleteFile', fileId: 'elsewhere' }])).toEqual(before);
  });
});
